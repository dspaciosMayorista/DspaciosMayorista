"use client";

import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { addMonths, format, startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import { calendarError, calendarValue, displayCalendarValue, parseCalendarText, parseCalendarValue, type CalendarPrecision } from "@/lib/calendarValue";
import "react-day-picker/style.css";
import styles from "./DateInput.module.css";

type DateInputProps = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"> & {
  type?: CalendarPrecision;
  value?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  onValueChange?: (value: string) => void;
};

function CalendarSelect({ label, value, options, onValueChange }: {
  label: string; value: number; options: { value: number; label: string }[];
  onValueChange: (value: number) => void;
}) {
  return (
    <Select.Root value={value} onValueChange={(next) => { if (next !== null) onValueChange(next); }}>
      <Select.Trigger aria-label={label} className={styles.selectTrigger}>
        <Select.Value>{options.find((option) => option.value === value)?.label}</Select.Value>
        <Select.Icon><ChevronDown size={14} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className={styles.selectPositioner} sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className={styles.selectPopup}>
            <Select.List>
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value} className={styles.selectItem}>
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

export function DateInput({
  type = "date", value, defaultValue = "", onValueChange, min, max,
  name, id, className, disabled, readOnly, required, form, ref,
  onBlur, onKeyDown, ...inputProps
}: DateInputProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-date`;
  const errorId = `${generatedId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [localValue, setLocalValue] = useState(defaultValue);
  const currentValue = value ?? localValue;
  const [draft, setDraft] = useState({ value: currentValue, text: displayCalendarValue(currentValue, type) });
  const text = draft.value === currentValue ? draft.text : displayCalendarValue(currentValue, type);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(parseCalendarValue(currentValue, type) ?? new Date()));
  const selected = parseCalendarValue(currentValue, type);
  const minDate = parseCalendarValue(min ?? "", type);
  const maxDate = parseCalendarValue(max ?? "", type);
  const today = new Date();
  const error = calendarError(text, type, min, max);
  const label = inputProps["aria-label"] ?? inputProps.title ?? (type === "month" ? "Mes" : "Fecha");
  const minYear = minDate?.getFullYear() ?? Math.min(1900, month.getFullYear());
  const maxYear = maxDate?.getFullYear() ?? Math.max(today.getFullYear() + 100, month.getFullYear());
  const years = Array.from({ length: Math.max(0, maxYear - minYear + 1) }, (_, i) => ({ value: minYear + i, label: String(minYear + i) }));
  const months = Array.from({ length: 12 }, (_, i) => ({ value: i, label: format(new Date(2000, i, 1), "LLLL", { locale: es }) }));

  useEffect(() => {
    inputRef.current?.setCustomValidity(error);
  }, [error]);

  useEffect(() => {
    const owner = inputRef.current?.form;
    if (!owner || value !== undefined) return;
    const reset = () => {
      setLocalValue(defaultValue);
      setDraft({ value: defaultValue, text: displayCalendarValue(defaultValue, type) });
      setTouched(false);
      setOpen(false);
    };
    owner.addEventListener("reset", reset);
    return () => owner.removeEventListener("reset", reset);
  }, [defaultValue, type, value, form]);

  function change(next: string, display = displayCalendarValue(next, type)) {
    setDraft({ value: next, text: display });
    if (value === undefined) setLocalValue(next);
    onValueChange?.(next);
  }

  function openCalendar(next: boolean) {
    if (disabled || readOnly) return;
    if (next) {
      let initial = selected ?? today;
      if (minDate && initial < minDate) initial = minDate;
      if (maxDate && initial > maxDate) initial = maxDate;
      setMonth(startOfMonth(initial));
    }
    setOpen(next);
  }

  function choose(date: Date) {
    const next = calendarValue(date, type);
    if (calendarError(displayCalendarValue(next, type), type, min, max)) return;
    change(next);
    setTouched(false);
    setOpen(false);
  }

  function navigateMonth(next: Date) {
    if (minDate && next < startOfMonth(minDate)) next = startOfMonth(minDate);
    if (maxDate && next > startOfMonth(maxDate)) next = startOfMonth(maxDate);
    setMonth(next);
  }

  const canMove = (delta: number) => {
    const next = addMonths(month, type === "month" ? delta * 12 : delta);
    if (type === "month") return next.getFullYear() >= minYear && next.getFullYear() <= maxYear;
    return (!minDate || next >= startOfMonth(minDate)) && (!maxDate || next <= startOfMonth(maxDate));
  };

  return (
    <Popover.Root open={open && !disabled && !readOnly} onOpenChange={openCalendar}>
      <div className={cn("flex flex-wrap items-center min-w-0 w-full min-h-8 px-2 py-1 gap-1 border border-slate-300 rounded-lg bg-white text-sm text-slate-800", styles.field, className)} ref={anchorRef} data-date-field data-disabled={disabled || undefined} data-invalid={touched && !!error || undefined}>
        <input
          {...inputProps}
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          id={inputId} type="text" form={form} className={styles.input}
          value={text} disabled={disabled} readOnly={readOnly} required={required}
          inputMode="numeric" autoComplete={inputProps.autoComplete ?? "off"}
          placeholder={inputProps.placeholder ?? (type === "month" ? "mm/aaaa" : "dd/mm/aaaa")}
          aria-label={label}
          aria-invalid={inputProps["aria-invalid"] ?? (touched && !!error || undefined)}
          aria-describedby={[inputProps["aria-describedby"], touched && error ? errorId : null].filter(Boolean).join(" ") || undefined}
          onChange={(event) => {
            const nextText = event.target.value;
            change(parseCalendarText(nextText, type), nextText);
          }}
          onBlur={(event) => { setTouched(true); onBlur?.(event); }}
          onInvalid={() => setTouched(true)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (!event.defaultPrevented && event.key === "ArrowDown") {
              event.preventDefault();
              openCalendar(true);
            }
          }}
        />
        {name && <input type="hidden" name={name} form={form} value={currentValue} disabled={disabled} />}
        <Popover.Trigger className={styles.trigger} disabled={disabled || readOnly} aria-label={`Abrir calendario: ${label}`} title="Abrir calendario">
          <CalendarDays size={17} aria-hidden />
        </Popover.Trigger>
        {touched && error && <span id={errorId} role="status" className={styles.error}>{error}</span>}
      </div>
      <Popover.Portal>
        <Popover.Positioner anchor={anchorRef} sideOffset={6} align="start" collisionPadding={12} className={styles.positioner}>
          <Popover.Popup className={styles.popup} aria-label={`Calendario: ${label}`} finalFocus={inputRef}>
            <Popover.Title className={styles.title}>{label}</Popover.Title>
            <div className={styles.navigation}>
              <button type="button" className={styles.navButton} aria-label={type === "month" ? "Año anterior" : "Mes anterior"} disabled={!canMove(-1)} onClick={() => setMonth(addMonths(month, type === "month" ? -12 : -1))}><ChevronLeft size={18} /></button>
              {type === "date" && <CalendarSelect label="Mes del calendario" value={month.getMonth()} options={months.filter((option) => {
                const candidate = new Date(month.getFullYear(), option.value, 1);
                return (!minDate || candidate >= startOfMonth(minDate)) && (!maxDate || candidate <= startOfMonth(maxDate));
              })} onValueChange={(next) => navigateMonth(new Date(month.getFullYear(), next, 1))} />}
              <CalendarSelect label="Año del calendario" value={month.getFullYear()} options={years} onValueChange={(next) => navigateMonth(new Date(next, month.getMonth(), 1))} />
              <button type="button" className={styles.navButton} aria-label={type === "month" ? "Año siguiente" : "Mes siguiente"} disabled={!canMove(1)} onClick={() => setMonth(addMonths(month, type === "month" ? 12 : 1))}><ChevronRight size={18} /></button>
            </div>
            {type === "month" ? (
              <div className={styles.monthGrid}>
                {months.map((option) => {
                  const date = new Date(month.getFullYear(), option.value, 1);
                  const iso = calendarValue(date, "month");
                  return <button type="button" key={option.value} aria-pressed={iso === currentValue} disabled={!!calendarError(displayCalendarValue(iso, "month"), "month", min, max)} onClick={() => choose(date)}>{option.label}</button>;
                })}
              </div>
            ) : (
              <DayPicker mode="single" required locale={es} weekStartsOn={1}
                className={styles.calendar} classNames={{ month_caption: styles.hiddenCaption }}
                month={month} onMonthChange={setMonth} selected={selected} onSelect={choose}
                startMonth={minDate ? startOfMonth(minDate) : undefined} endMonth={maxDate ? startOfMonth(maxDate) : undefined}
                disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
                hideNavigation showOutsideDays fixedWeeks
              />
            )}
            <div className={styles.footer}>
              <button type="button" disabled={!text} onClick={() => { change(""); setTouched(false); setOpen(false); }}>Limpiar</button>
              <button type="button" disabled={!!calendarError(displayCalendarValue(calendarValue(today, type), type), type, min, max)} onClick={() => choose(today)}>{type === "month" ? "Este mes" : "Hoy"}</button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
