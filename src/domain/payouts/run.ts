import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  notExists,
  notInArray,
  sql,
} from "drizzle-orm";
import type { Context } from "../context";
import { causedBy } from "../errors";
import { insertWhile } from "../guarded";
import { LEDGER_KINDS, ledgerWrites } from "../ledger";
import { startClock } from "../clocks";
import { formatRands } from "../shared/money";
import { DAY_MS, HOUR_MS, MINUTE_MS, saDay, saDayStart } from "../shared/sa-days";
import {
  accounts,
  admins,
  engagements,
  ledgerEntries,
  payoutRuns,
  payouts,
  refunds,
  STOPPED_PAYOUT_STATES,
  verificationChecks,
} from "../schema";
import { emailAddress } from "../tells";
import { currentPayoutAccount } from "../verification";
import { PAUSED_CLOCK, payoutStopped } from "./events";
import { UNSETTLED_STATES } from "../refunds/rows";
import { payoutReference, UNPAID_STATES } from "./rows";

// The daily Payout run (#128): once a day, at one South African time, every
// Release owed to an Artisan with a current Payout account and no Payout
// hold is sent as a Payout. Before it, the float's balance is checked; if it
// cannot cover the run, every Admin is emailed (the one thing an Admin is
// emailed about), the Admin home shows a banner until it can, and every owed
// Release waits as a paused Payout: unpaid, nobody told, until a later run
// finds the float covering it. A run that fails part-way is retried each
// later minute that day, with no second float check.
// A Release whose Payout the bank refused or sent back is owed again, and
// goes in the first run after the Admin accepts a new Payout account (#129).

type PayoutAccount = typeof verificationChecks.$inferSelect;

/**
 * Runs today's Payouts once its time of day has come in South Africa, if
 * they have not all gone today. Called every minute, so a run missed at its
 * time goes the first minute after, and one that failed part-way goes again.
 * Its emails go after it, with the Tells'.
 */
export async function runPayouts(ctx: Context) {
  const now = ctx.now();
  const day = saDay(now);
  if (now < runTimeOn(day, ctx.config.payoutRunTime)) return { ran: false as const };
  let run = await runOn(ctx, day);
  if (run?.finishedAt) return { ran: false as const };

  const failures: unknown[] = [];
  // Settled first, so a Release whose Payout never went is owed in this run.
  await settleUnsent(ctx, failures);
  let owed: Release[] | null = null;
  if (!run) {
    owed = await releasesToSend(ctx);
    const neededCents =
      (await floatNeededCents(ctx)) + owed.reduce((sum, r) => sum + r.amountCents, 0);
    const { cents: floatCents } = await ctx.ports.payments.getFloatBalance();
    // Claims the day, so two runs at once send nothing twice, and the float is checked once.
    const [claimed] = await ctx.db
      .insert(payoutRuns)
      .values({ day, ranAt: now, floatCents, neededCents })
      .onConflictDoNothing()
      .returning();
    if (!claimed) return { ran: false as const };
    run = claimed;
    if (floatCents < neededCents) {
      await ctx.commit(await floatShortEmails(ctx, floatCents, neededCents));
      // The float pauses the run: each Release owed waits as a paused Payout.
      for (const release of owed) await pause(ctx, release);
      return { ran: true as const, sent: 0, floatShort: true };
    }
  }

  if (run.floatCents < run.neededCents) {
    // A run claimed while the float was short sends nothing until the float
    // covers what is still owed; each later minute checks again.
    const { cents: floatCents } = await ctx.ports.payments.getFloatBalance();
    const fresh = await releasesToSend(ctx);
    const stillNeeded =
      (await floatNeededCents(ctx)) + fresh.reduce((sum, r) => sum + r.amountCents, 0);
    if (floatCents < stillNeeded) {
      // A Release owed while the float is short waits as a paused Payout too.
      for (const release of fresh) await pause(ctx, release);
      return { ran: true as const, sent: 0, floatShort: true };
    }
    // Covered: the run resumes, and a retry after a failure checks nothing again.
    await ctx.db.update(payoutRuns).set({ floatCents }).where(eq(payoutRuns.day, day));
    run = { ...run, floatCents };
  }

  let sent = 0;
  // A Payout an earlier run created but never heard back on is asked again, by the same id.
  for (const payout of await unanswered(ctx)) {
    await ask(ctx, payout).catch((error: unknown) => failures.push(error));
  }
  // So is one the float paused, now that it covers.
  for (const payout of await pausedPayouts(ctx)) {
    await ask(ctx, payout).catch((error: unknown) => failures.push(error));
  }
  for (const release of owed ?? (await releasesToSend(ctx))) {
    try {
      if (await send(ctx, release)) sent += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} Payouts did not go`);
  }
  await ctx.db
    .update(payoutRuns)
    .set({ finishedAt: ctx.now() })
    .where(and(eq(payoutRuns.day, day), isNull(payoutRuns.finishedAt)));
  return { ran: true as const, sent, floatShort: run.floatCents < run.neededCents };
}

/** The instant a South African time of day ("10:00") falls on a day. */
function runTimeOn(day: string, time: string): Date {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new Error(`The Payout run time "${time}" is not a time of day like 10:00`);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return new Date(saDayStart(day).getTime() + minutes * MINUTE_MS);
}

async function runOn(ctx: Context, day: string) {
  const [run] = await ctx.db.select().from(payoutRuns).where(eq(payoutRuns.day, day));
  return run ?? null;
}

/** The latest run's float check, if any run has gone. */
export async function latestRun(ctx: Context) {
  const [run] = await ctx.db.select().from(payoutRuns).orderBy(desc(payoutRuns.day)).limit(1);
  return run ?? null;
}

/**
 * What the float must still pay out: the Payouts sent and not yet paid, and
 * the Refunds on their way, which it pays too (#132).
 */
export async function floatNeededCents(ctx: Context): Promise<number> {
  const cents = sql<number>`coalesce(sum(amount_cents), 0)`;
  const [[unpaid], [refunding]] = await Promise.all([
    ctx.db.select({ cents }).from(payouts).where(inArray(payouts.state, UNPAID_STATES)),
    ctx.db.select({ cents }).from(refunds).where(inArray(refunds.state, UNSETTLED_STATES)),
  ]);
  return (unpaid?.cents ?? 0) + (refunding?.cents ?? 0);
}

/**
 * Every Release owed with no Payout going (none yet, or only ones the bank
 * refused or sent back), to an Artisan whose Payouts are not held and who
 * has a current Payout account, oldest first, with that account.
 */
async function releasesToSend(ctx: Context) {
  const rows = await ctx.db
    .select({
      owedEntryId: ledgerEntries.id,
      amountCents: ledgerEntries.amountCents,
      paymentId: ledgerEntries.paymentId,
      engagementId: engagements.id,
      artisanId: engagements.artisanId,
    })
    .from(ledgerEntries)
    .innerJoin(engagements, eq(engagements.id, ledgerEntries.engagementId))
    .innerJoin(accounts, eq(accounts.id, engagements.artisanId))
    .where(
      and(
        eq(ledgerEntries.kind, LEDGER_KINDS.payoutOwed),
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(payouts)
            .where(
              and(
                eq(payouts.owedEntryId, ledgerEntries.id),
                notInArray(payouts.state, [...STOPPED_PAYOUT_STATES]),
              ),
            ),
        ),
        // Suspension holds nothing by itself, returned money included; the Admin holds Payouts (#136).
        isNull(accounts.payoutsHeldAt),
      ),
    )
    .orderBy(asc(ledgerEntries.recordedAt), asc(ledgerEntries.id));
  const accountOf = new Map<string, PayoutAccount | null>();
  const toSend = [];
  for (const row of rows) {
    if (!accountOf.has(row.artisanId)) {
      accountOf.set(row.artisanId, await currentPayoutAccount(ctx, row.artisanId));
    }
    const account = accountOf.get(row.artisanId);
    if (account) toSend.push({ ...row, account });
  }
  return toSend;
}

type Release = Awaited<ReturnType<typeof releasesToSend>>[number];

type PayoutState = "created" | "paused";

/**
 * Writes the Payout of one Release owed, with its ledger row, in the given
 * state. False if another run created it first, the Admin held the Artisan's
 * Payouts since they were read, or the bank stopped the account since, as it
 * may for an earlier Payout of this run.
 */
async function createPayout(ctx: Context, release: Release, state: PayoutState) {
  if (!release.paymentId) throw new Error(`Release ${release.owedEntryId} has no Payment`);
  const payout = {
    id: ctx.newId(),
    owedEntryId: release.owedEntryId,
    artisanId: release.artisanId,
    engagementId: release.engagementId,
    payoutAccountId: release.account.id,
    amountCents: release.amountCents,
    state,
    refusedFor: null,
    createdAt: ctx.now(),
    pausedAt: state === "paused" ? ctx.now() : null,
    paidAt: null,
    stoppedAt: null,
  };
  try {
    // Written before the adapter is asked, so its events always find it.
    await ctx.commit([
      insertWhile(
        ctx,
        payouts,
        payout,
        and(notHeld(ctx, release.artisanId), notStopped(ctx, release.account.id))!,
      ),
      // As a provider's pause would: after 3 days the Artisan is told it is delayed, not lost.
      ...(state === "paused"
        ? [
            startClock(ctx, {
              kind: PAUSED_CLOCK,
              subjectId: payout.id,
              dueAt: new Date(ctx.now().getTime() + 3 * DAY_MS),
            }),
          ]
        : []),
      ...ledgerWrites(
        ctx,
        [
          {
            kind: LEDGER_KINDS.payoutCreated,
            amountCents: payout.amountCents,
            paymentId: release.paymentId,
            engagementId: release.engagementId,
          },
        ],
        exists(
          ctx.db
            .select({ one: sql`1` })
            .from(payouts)
            .where(eq(payouts.id, payout.id)),
        ),
      ),
    ]);
  } catch (error) {
    // Another run sent this Release first.
    if (causedBy(error, "UNIQUE constraint failed: payouts.owed_entry_id")) return false;
    throw error;
  }
  const [written] = await ctx.db
    .select({ id: payouts.id })
    .from(payouts)
    .where(eq(payouts.id, payout.id));
  return written ? payout : false;
}

/**
 * Creates the Payout of one Release owed, then asks the adapter to send it.
 */
async function send(ctx: Context, release: Release): Promise<boolean> {
  const payout = await createPayout(ctx, release, "created");
  if (!payout) return false;
  await ask(ctx, { ...payout, account: release.account });
  return true;
}

/**
 * Creates the Payout of one Release owed as paused, because the float cannot
 * cover it: unpaid, nobody told, until a later run finds it can and asks.
 */
async function pause(ctx: Context, release: Release): Promise<boolean> {
  return !!(await createPayout(ctx, release, "paused"));
}

/**
 * The Payouts created but never answered by the adapter, with the account
 * each goes to, while their Artisan's Payouts are not held and that account
 * is still current. One whose account stopped being current is settled
 * before the run instead.
 */
async function unanswered(ctx: Context) {
  const asked = [];
  for (const row of await payoutsIn(ctx, ["created"], { held: false })) {
    const current = await currentPayoutAccount(ctx, row.payout.artisanId);
    if (current?.id === row.account.id) asked.push({ ...row.payout, account: row.account });
  }
  return asked;
}

/**
 * The Payouts the float paused, oldest first, with the account each goes to
 * while their Artisan's Payouts are not held and that account is still
 * current - asked again once the float covers.
 */
async function pausedPayouts(ctx: Context) {
  const asked = [];
  for (const row of await payoutsIn(ctx, ["paused"], { held: false })) {
    const current = await currentPayoutAccount(ctx, row.payout.artisanId);
    if (current?.id === row.account.id) asked.push({ ...row.payout, account: row.account });
  }
  return asked;
}

/** The Payouts still in the given states, oldest first, with the account each goes to. */
async function payoutsIn(ctx: Context, states: PayoutState[], { held }: { held: boolean }) {
  return ctx.db
    .select({ payout: payouts, account: verificationChecks })
    .from(payouts)
    .innerJoin(verificationChecks, eq(verificationChecks.id, payouts.payoutAccountId))
    .innerJoin(accounts, eq(accounts.id, payouts.artisanId))
    .where(and(inArray(payouts.state, states), held ? undefined : isNull(accounts.payoutsHeldAt)))
    .orderBy(asc(payouts.createdAt), asc(payouts.id));
}

/** How long a created Payout may still be on its way to the adapter, from a run in flight. */
const ASKING_FOR_MS = HOUR_MS;

/**
 * Each Payout created but never answered, or paused, whose account is no
 * longer the Artisan's current one, such as one the bank stopped meanwhile:
 * it is not asked again, as that would send it to that account. If the
 * provider never had it - as it never does for one the float paused - it is
 * unsent and its Release is owed again; if it had it, it stands as the
 * provider says, so a provider-paused one stays paused. One created within
 * the hour is left, as a run may still be asking for it. A Payout that
 * cannot be settled is a failure of the run, and waits for its next minute.
 */
async function settleUnsent(ctx: Context, failures: unknown[]) {
  const askedBefore = new Date(ctx.now().getTime() - ASKING_FOR_MS);
  for (const { payout } of await payoutsIn(ctx, ["created", "paused"], { held: true })) {
    if (payout.createdAt > askedBefore) continue;
    try {
      const current = await currentPayoutAccount(ctx, payout.artisanId);
      if (current?.id === payout.payoutAccountId) continue;
      const known = await ctx.ports.payments.getPayout(payout.id);
      if (known?.state === "refused") {
        await payoutStopped(ctx, payout.id, { to: "refused", reason: "refused" });
        continue;
      }
      if (known && payout.state === "paused") continue;
      await ctx.db
        .update(payouts)
        .set(known ? { state: "pending" } : { state: "unsent", stoppedAt: ctx.now() })
        .where(and(eq(payouts.id, payout.id), inArray(payouts.state, ["created", "paused"])));
    } catch (error) {
      failures.push(error);
    }
  }
}

/** The SQL that is true while no bank has stopped this Payout account, as one may mid-run. */
function notStopped(ctx: Context, payoutAccountId: string) {
  return exists(
    ctx.db
      .select({ one: sql`1` })
      .from(verificationChecks)
      .where(
        and(
          eq(verificationChecks.id, payoutAccountId),
          isNull(verificationChecks.payoutsStoppedAt),
        ),
      ),
  );
}

/** The SQL that is true while the Artisan's Payouts are not held. */
function notHeld(ctx: Context, artisanId: string) {
  return exists(
    ctx.db
      .select({ one: sql`1` })
      .from(accounts)
      .where(and(eq(accounts.id, artisanId), isNull(accounts.payoutsHeldAt))),
  );
}

/**
 * Asks the adapter to send a Payout. Our id is the idempotency key, so asking
 * again is harmless. A bank that refuses it at once stops it, as it would a
 * refusal later.
 */
async function ask(
  ctx: Context,
  payout: { id: string; amountCents: number; account: PayoutAccount },
) {
  const { accountHolder, accountNumber, branchCode } = payout.account.details;
  if (!accountHolder || !accountNumber || !branchCode) {
    throw new Error(`Payout account ${payout.account.id} has no bank details`);
  }
  const answer = await ctx.ports.payments.createPayout({
    id: payout.id,
    amountCents: payout.amountCents,
    bankAccount: { accountHolder, accountNumber, branchCode },
    beneficiaryReference: payoutReference(payout.id),
  });
  if (answer.state === "refused") {
    await payoutStopped(ctx, payout.id, { to: "refused", reason: answer.reason });
    return;
  }
  // Only from created or paused: its event may have arrived first.
  await ctx.db
    .update(payouts)
    .set({ state: "pending" })
    .where(and(eq(payouts.id, payout.id), inArray(payouts.state, ["created", "paused"])));
}

/** The emails telling every Admin the float cannot cover the run. */
async function floatShortEmails(ctx: Context, floatCents: number, neededCents: number) {
  const current = await ctx.db
    .select({ email: admins.email })
    .from(admins)
    .where(isNull(admins.removedAt));
  return current.map(({ email }) =>
    emailAddress(ctx, email, {
      event: "payouts.float-short",
      title: "The float cannot cover today's Payouts",
      link: "/admin",
      body: [
        `The float holds ${formatRands(floatCents)}, and today's Payouts and the Refunds on their way need ${formatRands(neededCents)}.`,
        "The Payouts wait, unpaid, until the float is topped up; nobody is told unless they stay paused three days.",
        "The Admin home shows a banner until the float can cover them.",
      ].join("\n\n"),
    }),
  );
}
