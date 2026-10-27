"use client";

import { useState } from "react";
import { pricingCheckoutPath, scanCheckoutPath, signInPath } from "@/lib/checkout-path";
import { requestCheckout } from "@/lib/checkout-request";
import { TAX_NOTE, TIERS, UPGRADE_ACTIONS, type TierId } from "@/lib/pricing";

const ALL_TIERS: TierId[] = ["report", "rescan", "monitor"];

export function UpgradePanel({
  scanId,
  collectBilling = false,
  tierIds = ALL_TIERS,
  heading = "Unlock the rest of this report",
  lede = "The scan already finished. Paying opens the stored findings. It does not rescan, except the rescan credit.",
  id,
}: {
  scanId: string;
  collectBilling?: boolean;
  tierIds?: readonly TierId[];
  heading?: string;
  lede?: string;
  id?: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [country, setCountry] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipcode, setZipcode] = useState("");
  const [name, setName] = useState("");
  const tiers = tierIds.map((tierId) => TIERS[tierId]);

  async function checkout(tier: TierId) {
    setError("");
    setBusy(tier);
    const result = await requestCheckout({
      tier,
      scanId,
      ...(collectBilling
        ? { billing: { country: country.trim(), street: street.trim(), city: city.trim(), state: state.trim(), zipcode: zipcode.trim(), ...(name.trim() ? { name: name.trim() } : {}) } }
        : {}),
    });
    setBusy("");
    if (!result.ok) {
      if (result.status === 401) {
        window.location.href = signInPath(scanId ? scanCheckoutPath(scanId, tier) : pricingCheckoutPath(tier));
        return;
      }
      setError(result.error);
      return;
    }
    window.location.href = result.url;
  }

  return (
    <div id={id} className="rounded-3xl border border-[#ead98a] bg-[#fff7d4] p-5 text-ink">
      <h3 className="font-display text-2xl">{heading}</h3>
      {lede ? <p className="mt-1 text-sm text-[#5c5644]">{lede}</p> : null}
      {collectBilling ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <p className="text-sm text-[#5c5644] md:col-span-2">Checkout needs a billing country and address.</p>
          <label className="text-sm">
            Billing country
            <input className="field mt-1" value={country} onChange={(event) => setCountry(event.target.value)} placeholder="US" maxLength={2} autoComplete="country" />
          </label>
          <label className="text-sm">
            Name on the receipt
            <input className="field mt-1" value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" autoComplete="name" />
          </label>
          <label className="text-sm md:col-span-2">
            Street
            <input className="field mt-1" value={street} onChange={(event) => setStreet(event.target.value)} autoComplete="address-line1" />
          </label>
          <label className="text-sm">
            City
            <input className="field mt-1" value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" />
          </label>
          <label className="text-sm">
            State
            <input className="field mt-1" value={state} onChange={(event) => setState(event.target.value)} autoComplete="address-level1" />
          </label>
          <label className="text-sm">
            Postal code
            <input className="field mt-1" value={zipcode} onChange={(event) => setZipcode(event.target.value)} autoComplete="postal-code" />
          </label>
        </div>
      ) : null}
      <div className={`mt-4 grid gap-3 ${tiers.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {tiers.map((tier) => (
          <article key={tier.id} className="rounded-2xl bg-white p-4 text-left shadow-sm">
            <div className="text-xs uppercase tracking-wide text-[#6d6758]">{tier.cadence}</div>
            <div className="mt-1 font-display text-3xl">{tier.priceLabel}</div>
            <p className="text-xs text-[#6d6758]">{TAX_NOTE}</p>
            <div className="font-semibold">{tier.name}</div>
            <p className="mt-2 text-sm text-[#4e584f]">{tier.blurb}</p>
            <button className="btn btn-ink mt-4 w-full" disabled={busy === tier.id} onClick={() => checkout(tier.id)} type="button">
              {busy === tier.id ? "Starting checkout…" : UPGRADE_ACTIONS[tier.id]}
            </button>
          </article>
        ))}
      </div>
      {error ? (
        <p className="mt-3 text-sm text-[#8a2d18]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
