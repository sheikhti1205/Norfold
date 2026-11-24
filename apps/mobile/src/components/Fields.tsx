import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Button as AriaButton,
  Label as AriaLabel,
  ListBox,
  ListBoxItem,
  Select as AriaSelect,
  SelectValue,
} from "react-aria-components";
import { Check, ChevronDown, Eye, EyeOff } from "lucide-react";
import { LayeredPopover } from "./overlayFoundation";
import "./Fields.css";
import {
  fadeVariants,
  motionDurations,
  motionEasings,
  motionSprings,
  pressFeedback,
} from "./uiMotion";

interface FieldShellProps {
  label: string;
  /** id of the control this label describes (explicit association). */
  htmlFor: string;
  hint?: string;
  error?: string;
  errorId?: string;
  hintId?: string;
  /** Live availability/status line (role="status"), e.g. username checking. */
  status?: ReactNode;
  statusId?: string;
  /** True while the control has focus; drives the label lift. */
  focused?: boolean;
  /** Trailing control overlaid on the control (password reveal). */
  trailing?: ReactNode;
  children: ReactNode;
}

/**
 * Hint/validation message that grows from closed to its natural height and
 * collapses again. Height is the one sanctioned layout animation here: single
 * line and wrapped message both settle at the message's real height, and
 * there is deliberately no shake.
 */
export function AnimatedNote({
  id,
  role,
  className,
  children,
}: {
  id?: string;
  role?: "alert";
  className: string;
  children: ReactNode;
}) {
  return (
    <motion.span
      id={id}
      role={role}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: motionDurations.fast, ease: motionEasings.out }}
      className={`block overflow-hidden ${className}`}
    >
      {children}
    </motion.span>
  );
}

function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  errorId,
  hintId,
  status,
  statusId,
  focused,
  trailing,
  children,
}: FieldShellProps) {
  return (
    <div className="block">
      {/* Subtle focus acknowledgement: the label lifts a pixel, the border
          colour transition is handled by baseField's focus: rules. */}
      <motion.label
        htmlFor={htmlFor}
        animate={{ y: focused ? -1 : 0 }}
        transition={{ duration: motionDurations.instant, ease: motionEasings.out }}
        className="mb-1 block text-sm font-medium text-on-surface"
      >
        {label}
      </motion.label>
      <div className="relative">
        {children}
        {trailing}
      </div>
      {/* Hint and error share one slot so one leaves as the other arrives. */}
      <AnimatePresence initial={false}>
        {error ? (
          <AnimatedNote key="error" id={errorId} role="alert" className="mt-1 text-xs text-error">
            {error}
          </AnimatedNote>
        ) : hint ? (
          <AnimatedNote key="hint" id={hintId} className="mt-1 text-xs text-on-surface-variant">
            {hint}
          </AnimatedNote>
        ) : null}
      </AnimatePresence>
      {/* One live region that persists across text updates, so it never blinks. */}
      <AnimatePresence initial={false}>
        {status != null ? (
          <motion.span
            key="status"
            id={statusId}
            role="status"
            variants={fadeVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: motionDurations.fast, ease: motionEasings.out }}
            className="mt-1 block text-xs text-on-surface"
          >
            {status}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const baseField =
  "w-full rounded-m3-sm border border-outline-variant bg-surface px-3.5 py-3 text-base text-on-surface placeholder:text-on-surface-variant focus:border-on-surface disabled:opacity-50 transition-colors";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  /** Live availability/status line rendered under the field. */
  status?: ReactNode;
}

export function TextField({
  label,
  error,
  hint,
  status,
  className = "",
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const isPassword = rest.type === "password";
  const inputType = isPassword ? (revealed ? "text" : "password") : rest.type;

  return (
    <FieldShell
      label={label}
      htmlFor={id}
      error={error}
      hint={hint}
      status={status}
      errorId={errorId}
      hintId={hintId}
      statusId={statusId}
      focused={focused}
      trailing={
        isPassword ? (
          <motion.button
            type="button"
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            onClick={() => setRevealed((current) => !current)}
            whileTap={pressFeedback.iconButton}
            animate={{ opacity: focused ? 1 : 0.7 }}
            transition={motionSprings.snappy}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-m3-sm text-on-surface-variant"
          >
            {/* Two stacked glyphs: the icon crossfades and rotates on toggle. */}
            <span className="relative block h-5 w-5">
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center"
                initial={false}
                animate={{ opacity: revealed ? 0 : 1, rotate: revealed ? -90 : 0 }}
                transition={motionSprings.snappy}
              >
                <Eye size={20} />
              </motion.span>
              <motion.span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center"
                initial={false}
                animate={{ opacity: revealed ? 1 : 0, rotate: revealed ? 0 : 90 }}
                transition={motionSprings.snappy}
              >
                <EyeOff size={20} />
              </motion.span>
            </span>
          </motion.button>
        ) : undefined
      }
    >
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={`${baseField} ${isPassword ? "pr-12" : ""} ${error ? "border-error" : ""} ${className}`}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...rest}
        type={inputType}
      />
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  /** Visible field label. Omit only when `aria-label` names the control. */
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
  /** Extra classes on the trigger, for rows that are not stacked form fields. */
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  name?: string;
  id?: string;
  "aria-label"?: string;
}

/** Sentinel for "no value". A real option may legitimately be `""` (for
 * example "Waiting for review"), and React Aria reserves `null` for no
 * selection at all, so the empty row needs its own key. */
const EMPTY_KEY = "__fb_empty_select__";

/**
 * The one dropdown in Norfold.
 *
 * Native `<select>` renders the operating system's menu: square, unstyled, and
 * different on every platform. This is the same anchored list language as the
 * app's action menus (rounded surface, 44px rows, hover tone, a check on the
 * selected row) and it is keyboard- and screen-reader-complete because React
 * Aria owns the listbox behaviour. Every dropdown adopts it.
 */
export function SelectField({
  label,
  value = "",
  onChange,
  options,
  placeholder,
  error,
  hint,
  disabled = false,
  className = "",
  triggerClassName = "",
  onOpenChange,
  name,
  id,
  "aria-label": ariaLabel,
}: SelectFieldProps) {
  const uid = useId();
  const errorId = `${uid}-error`;
  const hintId = `${uid}-hint`;
  // A real empty option is shown by its own label; an explicit placeholder is
  // the selectable "no filter / not chosen" row. A field that always holds a
  // value gets neither: a stray "Select…" row would be a state it cannot save.
  const hasEmptyOption = options.some((option) => option.value === "");
  const rows = [
    ...(placeholder != null && !hasEmptyOption ? [{ key: EMPTY_KEY, label: placeholder }] : []),
    ...options.map((option) => ({
      key: option.value === "" ? EMPTY_KEY : option.value,
      label: option.label,
    })),
  ];
  const hasEmptyRow = rows.some((row) => row.key === EMPTY_KEY);
  const selectedKey = value === "" ? (hasEmptyRow ? EMPTY_KEY : null) : value;
  return (
    <AriaSelect
      id={id}
      name={name}
      selectedKey={selectedKey}
      onSelectionChange={(key) =>
        onChange?.(key == null || key === EMPTY_KEY ? "" : String(key))
      }
      isDisabled={disabled}
      isInvalid={Boolean(error)}
      aria-label={ariaLabel}
      aria-describedby={error ? errorId : hint ? hintId : undefined}
      placeholder={placeholder}
      onOpenChange={onOpenChange}
      className={`block min-w-0 ${className}`}
    >
      {label != null && (
        <AriaLabel className="mb-1 block text-sm font-medium text-on-surface">{label}</AriaLabel>
      )}
      <AriaButton
        className={`${baseField} fb-select-trigger ${error ? "border-error" : ""} ${triggerClassName}`}
      >
        <SelectValue className="fb-select-value">
          {({ selectedText, isPlaceholder }) => (
            <span data-placeholder={isPlaceholder || undefined}>{selectedText}</span>
          )}
        </SelectValue>
        <ChevronDown size={16} aria-hidden="true" className="fb-select-chevron" />
      </AriaButton>
      {error ? (
        <span id={errorId} role="alert" className="mt-1 block text-xs text-error">{error}</span>
      ) : hint ? (
        <span id={hintId} className="mt-1 block text-xs text-on-surface-variant">{hint}</span>
      ) : null}
      <LayeredPopover className="fb-select-popover" offset={6}>
        <ListBox className="fb-select-list">
          {rows.map((row) => (
            <ListBoxItem
              key={row.key}
              id={row.key}
              textValue={row.label}
              className="fb-menu-item fb-select-item"
            >
              <span>{row.label}</span>
              <Check size={16} aria-hidden="true" className="fb-select-check" />
            </ListBoxItem>
          ))}
        </ListBox>
      </LayeredPopover>
    </AriaSelect>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span className="mt-1 block text-xs text-error" role="alert">
      {message}
    </span>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

/**
 * The multi-line sibling of `TextField`.
 *
 * It shares the ONE `FieldShell` (the same label lift, the same hint/error
 * slot, the same focus behaviour), so a long answer looks like the rest of
 * the form instead of being a second field style. The reason it lives here
 * rather than in a screen: two forms (the safety report note and the
 * feedback message) need it, and a form field is a primitive, not a screen.
 */
export function TextAreaField({
  label,
  error,
  hint,
  className = "",
  onFocus,
  onBlur,
  ...rest
}: TextAreaFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [focused, setFocused] = useState(false);

  return (
    <FieldShell
      label={label}
      htmlFor={id}
      error={error}
      hint={hint}
      errorId={errorId}
      hintId={hintId}
      focused={focused}
    >
      <textarea
        id={id}
        rows={4}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={`${baseField} min-h-[112px] resize-y leading-relaxed ${error ? "border-error" : ""} ${className}`}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        {...rest}
      />
    </FieldShell>
  );
}
