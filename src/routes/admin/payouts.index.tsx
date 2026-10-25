import { Banknote } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, rowLink, type DataColumn } from "@/components/data-table";
import { EmptyState, Page } from "@/components/page";
import { useAction, type Outcome } from "@/components/use-action";
import { formatRands } from "@/domain/shared/money";
import { copy, pageTitle } from "@/web/copy";
import { onlyForAdmins } from "@/web/guards";
import { getUnpaidTotals, holdPayouts, liftPayoutHold } from "@/web/payouts";

export const Route = createFileRoute("/admin/payouts/")({
  beforeLoad: ({ context }) => {
    onlyForAdmins(context);
  },
  loader: () => getUnpaidTotals(),
  head: () => ({ meta: [{ title: pageTitle(t.title) }] }),
  component: AdminPayouts,
});

const t = copy.admin.payouts;

type Row = Awaited<ReturnType<typeof getUnpaidTotals>>[number];

const columns: DataColumn<Row>[] = [
  {
    id: "artisan",
    header: t.artisan,
    accessorFn: (row) => row.name,
    cell: ({ row }) => (
      <div className="min-w-0">
        <Link
          to="/admin/payouts/$artisanId"
          params={{ artisanId: row.original.artisanId }}
          className={rowLink}
        >
          {row.original.name}
        </Link>
        <div className="truncate text-xs text-muted-foreground">{row.original.email}</div>
      </div>
    ),
  },
  {
    id: "unpaid",
    header: t.unpaid,
    accessorFn: (row) => row.unpaidCents,
    cell: ({ row }) => (
      <span className="tabular-nums">{formatRands(row.original.unpaidCents)}</span>
    ),
  },
  {
    id: "standing",
    header: t.standing,
    accessorFn: (row) => (row.held ? 1 : 0),
    cell: ({ row }) =>
      row.original.held ? (
        <Badge variant="destructive">{t.held}</Badge>
      ) : (
        <span className="text-muted-foreground">{t.flowing}</span>
      ),
  },
  {
    id: "act",
    header: t.act,
    enableSorting: false,
    cell: ({ row }) => <HoldToggle row={row.original} />,
  },
];

/** Each Artisan's unpaid total, and holding or freeing their Payouts (#128). */
function AdminPayouts() {
  const rows = Route.useLoaderData();
  return (
    <Page title={t.title} lead={t.lead}>
      <DataTable
        label={t.table}
        columns={columns}
        data={rows}
        empty={<EmptyState icon={<Banknote />}>{t.empty}</EmptyState>}
      />
    </Page>
  );
}

/** Holds the Artisan's Payouts, or lifts the hold; a refusal shows as a toast. */
function HoldToggle({ row }: { row: Row }) {
  const action = useAction();

  async function toggle() {
    const change = row.held ? liftPayoutHold : holdPayouts;
    await action.run(
      (): Promise<Outcome> => change({ data: { artisanId: row.artisanId } }),
      undefined,
      (message) => toast.error(message),
    );
  }

  return (
    // Above the row's link, so it can still be pressed.
    <Button
      variant="outline"
      size="sm"
      className="relative z-10"
      disabled={action.busy}
      onClick={() => void toggle()}
    >
      {row.held ? t.lift : t.hold}
    </Button>
  );
}
