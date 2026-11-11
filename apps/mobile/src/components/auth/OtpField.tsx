import { useId } from "react";

export function OtpField({
  label = "Verification code",
  value,
  onChange,
  maxLength = 6,
  disabled = false,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  maxLength?: 6 | 7 | 8 | 9 | 10;
  disabled?: boolean;
}) {
  const id = useId();
  const digits = value.replace(/\D/g, "").slice(0, maxLength);

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-on-surface">
        {label}
      </label>
      <input
        id={id}
        value={digits}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, maxLength))}
        onPaste={(event) => {
          event.preventDefault();
          onChange(event.clipboardData.getData("text").replace(/\D/g, "").slice(0, maxLength));
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={maxLength}
        disabled={disabled}
        className="min-h-11 w-full min-w-0 rounded-m3-sm border border-outline-variant bg-surface px-3.5 py-3 font-mono text-xl font-semibold tracking-wide text-on-surface focus:border-on-surface disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-on-surface-variant"
      />
    </div>
  );
}
