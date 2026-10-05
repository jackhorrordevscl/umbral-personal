import { forwardRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

// Margin utilities (with optional variant prefixes) belong to the wrapper so
// the toggle stays vertically centered on the input itself.
const MARGIN_CLASS = /^(?:[\w-]+:)*-?m[trblxyse]?-/;

const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className = '', ...props }, ref) {
    const [visible, setVisible] = useState(false);

    const tokens = className.split(/\s+/).filter(Boolean);
    const wrapperClass = tokens.filter((t) => MARGIN_CLASS.test(t)).join(' ');
    const inputClass = tokens.filter((t) => !MARGIN_CLASS.test(t)).join(' ');

    return (
      <div className={`relative ${wrapperClass}`.trim()}>
        <input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={`${inputClass} pr-10`.trim()}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={visible}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {visible ? (
            <EyeOff size={18} aria-hidden="true" />
          ) : (
            <Eye size={18} aria-hidden="true" />
          )}
        </button>
      </div>
    );
  },
);

export default PasswordInput;
