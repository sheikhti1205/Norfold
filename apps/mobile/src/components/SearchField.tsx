import { useRef, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { motionDurations, motionEasings, pressFeedback, scaleInVariants } from "./uiMotion";
import "./searchField.css";

/**
 * The app's one search field.
 *
 * Every search surface renders this pill: Home's expanded row, the global
 * search overlay, the report search page, and Connect. The field owns the
 * geometry, the leading magnifier slot, the elided prompt and the clear
 * action, so a surface cannot grow a second search-bar style of its own.
 * Surface actions that do not edit the text
 * (filters, close) live beside the pill, never inside it.
 *
 * `leading` replaces the magnifier when the field is the expanded state of a
 * compact row and the first control means "leave the field" (Home's back
 * arrow). `trailing` is reserved for an action that edits the text; nothing
 * is placed there today, and filters or close actions live beside the pill.
 */
export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name. The visible prompt stays decorative and elides. */
  ariaLabel: string;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  id?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Omit to hide the clear action. Focus returns to the input after a clear. */
  onClear?: () => void;
  className?: string;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "onChange" | "className" | "ref" | "placeholder" | "aria-label"
  > & { [key: `data-${string}`]: string | number | boolean | undefined };
}

export function SearchField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  inputRef,
  id,
  leading,
  trailing,
  onClear,
  className = "",
  inputProps,
}: SearchFieldProps) {
  const localInput = useRef<HTMLInputElement | null>(null);
  function setInput(node: HTMLInputElement | null) {
    localInput.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  }

  return (
    <div className={`fb-search-field-pill ${className}`.trim()} data-search-field>
      {leading ?? (
        <span className="fb-search-field-leading">
          <Search size={18} aria-hidden />
        </span>
      )}
      <div className="fb-search-field-entry">
        <input
          {...inputProps}
          ref={setInput}
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={ariaLabel}
          className="fb-search-field-input"
        />
        {value === "" && (
          <span className="fb-search-field-placeholder" aria-hidden="true">{placeholder}</span>
        )}
      </div>
      <AnimatePresence initial={false}>
        {value.length > 0 && onClear && (
          <motion.button
            key="clear"
            type="button"
            onClick={() => {
              onClear();
              // Clearing is done to retype. Without the hand-back the button
              // unmounts under the pointer and focus falls to <body>, so the
              // next Tab skips the field.
              localInput.current?.focus();
            }}
            aria-label="Clear search"
            whileTap={pressFeedback.iconButton}
            variants={scaleInVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: motionDurations.fast, ease: motionEasings.out }}
            className="fb-search-field-action"
          >
            <X size={16} aria-hidden />
          </motion.button>
        )}
      </AnimatePresence>
      {trailing}
    </div>
  );
}
