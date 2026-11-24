// Shown when an institution has been suspended (by the company console). Used on
// both the public login page and inside the signed-in shell, so a suspended
// institution can neither sign in nor keep using the app.
export function Suspended({ name }: { name?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700" aria-hidden>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
      </div>
      <h1 className="mt-5 text-[22px] font-semibold text-ink-900">{name || "This institution"} is unavailable</h1>
      <p className="mt-2 max-w-md text-[15px] text-ink-500">
        Access to this portal is currently paused. Please contact your administrator for details.
      </p>
    </div>
  );
}
