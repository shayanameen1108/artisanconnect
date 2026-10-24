import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Page, Refusal } from "@/components/page";
import { useAction } from "@/components/use-action";
import { formatRands } from "@/domain/shared/money";
import { copy, pageTitle } from "@/web/copy";
import { completeFakeCheckout, getFakeCheckout } from "@/web/fake-checkout";

const t = copy.fakeCheckout;

/**
 * The fake payment adapter's checkout, in every environment (#111): where
 * the Client is sent to pay, standing in for the provider's page.
 */
export const Route = createFileRoute("/fake-checkout/$collectionId")({
  loader: ({ params }) => getFakeCheckout({ data: { collectionId: params.collectionId } }),
  head: () => ({ meta: [{ title: pageTitle(copy.fakeCheckout.title) }] }),
  component: FakeCheckout,
});

function FakeCheckout() {
  const checkout = Route.useLoaderData();
  const { collectionId } = Route.useParams();
  const action = useAction();

  async function complete(outcome: "succeed" | "fail") {
    await action.run(
      async () => ({
        ok: true as const,
        value: await completeFakeCheckout({ data: { collectionId, outcome } }),
      }),
      ({ returnUrl }) => window.location.assign(returnUrl),
      undefined,
      false,
    );
  }

  return (
    <Page narrow>
      <Card>
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
          <CardDescription>{t.lead}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">{t.amount}</span>
            <span className="text-2xl font-semibold">{formatRands(checkout.amountCents)}</span>
          </div>
          {checkout.state === "pending" ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={action.busy} onClick={() => void complete("succeed")}>
                {t.pay}
              </Button>
              <Button
                variant="outline"
                disabled={action.busy}
                onClick={() => void complete("fail")}
              >
                {t.fail}
              </Button>
              <Refusal message={action.refusal} />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">{t.closed}</p>
              <Button
                variant="outline"
                disabled={action.busy}
                onClick={() => void complete("fail")}
              >
                {t.back}
              </Button>
              <Refusal message={action.refusal} />
            </div>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
