"use client";
import { useRef, useState, type FormEvent } from "react";
import { firstIssue, registerBidderSchema } from "@cafe/contracts";
import { bidderClient } from "@/lib/rpc";
import { describeError } from "@/lib/format";
import { saveSession } from "@/lib/session";

/** Registering returns a paddle number and a token (unary RegisterBidder). */
export function PaddleDialog({ trigger }: { trigger: (open: () => void) => React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // Same Zod schema the server uses: one rule set, two runtimes.
    const parsed = registerBidderSchema.safeParse({
      displayName: form.get("displayName"),
      company: form.get("company"),
      country: form.get("country"),
      isBot: false,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      setServerError(firstIssue(parsed.error));
      return;
    }
    setErrors({});
    setServerError(null);
    setBusy(true);
    try {
      const res = await bidderClient.registerBidder(parsed.data);
      saveSession({
        token: res.token,
        bidderId: res.bidder!.id,
        paddle: res.bidder!.paddle,
        displayName: res.bidder!.displayName,
      });
      dialog.current?.close();
    } catch (error) {
      setServerError(describeError(error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (name: string, label: string, placeholder: string, autoComplete: string) => (
    <div className="field">
      <label htmlFor={`reg-${name}`}>{label}</label>
      <input
        id={`reg-${name}`}
        name={name}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={errors[name] ? `reg-${name}-err` : undefined}
      />
      {errors[name] ? (
        <span className="field__error" id={`reg-${name}-err`}>
          {errors[name]}
        </span>
      ) : null}
    </div>
  );

  return (
    <>
      {trigger(() => dialog.current?.showModal())}
      <dialog ref={dialog} className="dialog" aria-labelledby="paddle-title">
        <form onSubmit={submit} noValidate>
          <h2 id="paddle-title">Get a bidding paddle</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Your paddle number identifies you on the floor. It comes with a $60,000 demo credit line.
          </p>
          {field("displayName", "Your name", "Valentina", "name")}
          {field("company", "Roastery or company", "Tostadores del Sur", "organization")}
          {field("country", "Country", "Colombia", "country-name")}
          {serverError && !Object.keys(errors).length ? <p className="notice notice--error">{serverError}</p> : null}
          <div className="dialog__actions">
            <button type="button" className="btn btn--ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button type="submit" className="btn btn--cherry" disabled={busy}>
              {busy ? "Registering…" : "Get paddle"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
