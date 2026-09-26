import type { ChangeEventHandler, Ref } from "react";
import "./DateField.css";

interface DateFieldProps {
  placeholder: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  className?: string;
  id?: string;
  name?: string;
  autoComplete?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * 비어 있을 때 안내 문구를 보여 주는 날짜 입력.
 *
 * Android WebView 의 `<input type="date">` 는 값이 없으면 칸만 비어 보여 "깨진 칸"처럼 읽혔다
 * (2026-09-26 가입·아이 추가 생년월일). 입력은 그대로 네이티브 선택기를 쓰고, 빈 동안만 안내를 겹친다.
 * JSX spread 는 디자인 시스템 정적 분석이 해석하지 못해 prop 을 하나씩 연결한다.
 */
export function DateField({
  placeholder,
  value,
  onChange,
  className,
  id,
  name,
  autoComplete,
  min,
  max,
  disabled,
  inputRef,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: DateFieldProps) {
  const empty = !value;
  return (
    <span className="hy-date-field" data-empty={empty ? "true" : "false"}>
      <input
        ref={inputRef}
        type="date"
        className={className}
        id={id}
        name={name}
        autoComplete={autoComplete}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        value={value}
        onChange={onChange}
      />
      {empty && (
        <span className="hy-date-field__placeholder" aria-hidden="true">{placeholder}</span>
      )}
    </span>
  );
}
