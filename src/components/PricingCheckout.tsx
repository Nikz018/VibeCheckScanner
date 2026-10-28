"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { pricingCheckoutPath, signInPath } from "@/lib/checkout-path";
import { requestCheckout, type CheckoutBilling } from "@/lib/checkout-request";
import { FREE_TIER, TAX_NOTE, TIERS, type TierId } from "@/lib/pricing";

const EMPTY_BILLING = { country: "", street: "", city: "", state: "", zipcode: "", name: "" };

export function PricingCheckout({
  signedIn,
  collectBilling,
  initialTier,
  monitoring = false,
}: {
  signedIn: boolean;
  collectBilling: boolean;
  initialTier: TierId | null;
  monitoring?: boolean;
}) {
  const [active, setActive] = useState<TierId | null>(initialTier);
  const [busy, setBusy] = useState<TierId | "">("");
  const [error, setError] = useState("");
  const [billing, setBilling] = useState(EMPTY_BILLING);

  useEffect(() => {
    if (monitoring || !signedIn || !initialTier || !collectBilling) return;
    let cancelled = false;
    void requestCheckout({ tier: initialTier }).then((probe) => {
      if (cancelled || probe.ok || probe.status !== 503) return;
      setActive(null);
      setError(probe.error);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn, initialTier, collectBilling, monitoring]);

  async function choose(tier: TierId) {
    setError("");
    if (!signedIn) {
      window.location.href = signInPath(pricingCheckoutPath(tier));
      return;
    }
    if (collectBilling && !billingReady(billing)) {
      setBusy(tier);
      const probe = await requestCheckout({ tier });
      setBusy("");
      if (!probe.ok && probe.status === 401) {
        window.location.href = signInPath(pricingCheckoutPath(tier));
        return;
      }
      if (!probe.ok && probe.status === 503) {
        setError(probe.error);
        return;
      }
      setActive(tier);
      return;
    }
    setActive(tier);
    if (!collectBilling) void submit(tier, billing);
  }

  async function submit(tier: TierId, draft: typeof billing) {
    if (collectBilling && !billingReady(draft)) {
      setError("Enter a 2-letter billing country plus street, city, state, and postal code.");
      return;
    }
    setBusy(tier);
    setError("");
    const result = await requestCheckout({
      tier,
      ...(collectBilling ? { billing: billingPayload(draft) } : {}),
    });
    setBusy("");
    if (!result.ok) {
      if (result.status === 401) {
        window.location.href = signInPath(pricingCheckoutPath(tier));
        return;
      }
      setError(result.error);
      return;
    }
    window.location.href = result.url;
  }

  return (
    <div className="space-y-4">
      {monitoring ? <p className="rounded-2xl border border-lime/40 bg-lime/10 px-4 py-3 text-sm font-semibold text-lime">You're on Monitoring</p> : null}
      <div className="grid gap-4 md:grid-cols-4">
        <article className="lift rounded-3xl border border-white/10 bg-white/5 p-5">
          <p className="font-semibold">{FREE_TIER.name}</p>
          <p className="font-display text-4xl">{FREE_TIER.priceLabel}</p>
          <p className="mt-3 text-sm text-[#c5d2e6]">{FREE_TIER.blurb}</p>
          <Link href="/check" className="btn btn-ghost mt-4 w-full">
            Start a mini check
          </Link>
        </article>
        {Object.values(TIERS).map((tier) => (
          <article key={tier.id} className={`lift rounded-3xl border border-lime/40 bg-[#121c30] p-5 ${active === tier.id ? "ring-2 ring-lime" : ""}`}>
            <p className="font-semibold">{tier.name}</p>
            <p className="font-display text-4xl">{tier.priceLabel}</p>
            <p className="text-xs">{TAX_NOTE}</p>
            <p className="mt-3 text-sm">{tier.blurb}</p>
            {monitoring ? (
              <p className="mt-4 text-sm font-semibold text-lime">You're on Monitoring</p>
            ) : signedIn ? (
              <button className="btn btn-lime mt-4 w-full" type="button" disabled={busy === tier.id} onClick={() => choose(tier.id)}>
                {busy === tier.id ? "Starting checkout…" : "Checkout"}
              </button>
            ) : (
              <a className="btn btn-lime mt-4 w-full" href={signInPath(pricingCheckoutPath(tier.id))}>
                Checkout
              </a>
            )}
          </article>
        ))}
      </div>
      {!monitoring && signedIn && active && collectBilling ? (
        <form
          className="paper rounded-3xl p-5 text-ink"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(active, billing);
          }}
        >
          <h2 className="font-display text-3xl">Checkout for {TIERS[active].name}</h2>
          <p className="mt-1 text-sm text-[#5c5644]">
            {TIERS[active].priceLabel} {TAX_NOTE}. Checkout needs a billing country and address.
          </p>
          <BillingFields billing={billing} onChange={setBilling} />
          <button className="btn btn-ink mt-4" disabled={busy === active} type="submit">
            {busy === active ? "Starting checkout…" : `Continue to checkout`}
          </button>
          {error ? (
            <p className="mt-3 text-sm text-[#8a2d18]" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {!monitoring && signedIn && active && !collectBilling ? (
        <div>
          <button className="btn btn-lime" disabled={busy === active} type="button" onClick={() => void submit(active, billing)}>
            {busy === active ? "Starting checkout…" : `Continue to checkout for ${TIERS[active].name} (${TIERS[active].priceLabel}, ${TAX_NOTE})`}
          </button>
        </div>
      ) : null}
      {!monitoring && error && !(signedIn && active && collectBilling) ? (
        <p className="text-sm text-[#f3c7bc]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function BillingFields({
  billing,
  onChange,
}: {
  billing: typeof EMPTY_BILLING;
  onChange: (next: typeof EMPTY_BILLING) => void;
}) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <label className="text-sm">
        Billing country
        <input className="field mt-1" value={billing.country} onChange={(event) => onChange({ ...billing, country: event.target.value })} placeholder="US" maxLength={2} autoComplete="country" />
      </label>
      <label className="text-sm">
        Name on the receipt
        <input className="field mt-1" value={billing.name} onChange={(event) => onChange({ ...billing, name: event.target.value })} placeholder="Optional" autoComplete="name" />
      </label>
      <label className="text-sm md:col-span-2">
        Street
        <input className="field mt-1" value={billing.street} onChange={(event) => onChange({ ...billing, street: event.target.value })} autoComplete="address-line1" />
      </label>
      <label className="text-sm">
        City
        <input className="field mt-1" value={billing.city} onChange={(event) => onChange({ ...billing, city: event.target.value })} autoComplete="address-level2" />
      </label>
      <label className="text-sm">
        State
        <input className="field mt-1" value={billing.state} onChange={(event) => onChange({ ...billing, state: event.target.value })} autoComplete="address-level1" />
      </label>
      <label className="text-sm">
        Postal code
        <input className="field mt-1" value={billing.zipcode} onChange={(event) => onChange({ ...billing, zipcode: event.target.value })} autoComplete="postal-code" />
      </label>
    </div>
  );
}

function billingReady(value: typeof EMPTY_BILLING): boolean {
  return /^[A-Za-z]{2}$/.test(value.country.trim()) && Boolean(value.street.trim() && value.city.trim() && value.state.trim() && value.zipcode.trim());
}

function billingPayload(value: typeof EMPTY_BILLING): CheckoutBilling {
  const name = value.name.trim();
  return {
    country: value.country.trim(),
    street: value.street.trim(),
    city: value.city.trim(),
    state: value.state.trim(),
    zipcode: value.zipcode.trim(),
    ...(name ? { name } : {}),
  };
}
