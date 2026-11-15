import { AtSign, Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { useState } from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  hint?: string;
  required?: boolean;
}

export function EmailField({ id, label, value, onChange, autoComplete = "username", autoFocus }: FieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup className="h-11">
        <InputGroupAddon>
          <AtSign />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="email"
          required
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          placeholder="nama@contoh.com"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </InputGroup>
    </Field>
  );
}

export function NameField({ id, label, value, onChange, autoFocus }: FieldProps) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup className="h-11">
        <InputGroupAddon>
          <UserRound />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          required
          minLength={2}
          maxLength={100}
          autoComplete="name"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </InputGroup>
    </Field>
  );
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = "current-password",
  autoFocus,
  hint,
  required = true,
}: FieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup className="h-11">
        <InputGroupAddon>
          <LockKeyhole />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type={visible ? "text" : "password"}
          required={required}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          placeholder="••••••••"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}

export const PASSWORD_HINT = "Minimal 8 karakter, bukan kata sandi umum, tidak memuat alamat email.";
