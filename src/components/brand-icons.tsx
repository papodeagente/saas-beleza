/**
 * Selos de rede social para a página pública de agendamento.
 *
 * Desenho próprio, simplificado — não é o arquivo oficial de nenhuma marca —
 * mas reconhecível o bastante pra cliente entender "isto é o Instagram do
 * salão" num relance. `lucide-react` (o resto dos ícones do projeto) não tem
 * logotipos de marca de propósito, então esses cinco vivem aqui, isolados.
 */

type IconProps = { className?: string };

export function WhatsappIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none" aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#25D366" />
      <path
        d="M20 10a10 10 0 0 0-8.66 15l-1.1 4.1 4.2-1.1A10 10 0 1 0 20 10Z"
        fill="#fff"
      />
      <path
        d="M20 11.6a8.4 8.4 0 0 0-7.2 12.7l.2.35-.66 2.4 2.47-.65.34.2A8.4 8.4 0 1 0 20 11.6Z"
        fill="#25D366"
      />
      <path
        d="M17 15.4c-.22-.5-.4-.5-.6-.5h-.5c-.18 0-.47.07-.7.34-.25.27-.94.9-.94 2.2s.96 2.55 1.1 2.73c.13.16 1.85 2.96 4.6 4.03 2.28.9 2.74.72 3.24.68.5-.05 1.6-.66 1.83-1.3.22-.62.22-1.16.15-1.28-.07-.12-.25-.19-.5-.32-.28-.13-1.6-.8-1.85-.9-.25-.09-.43-.13-.6.14-.19.27-.7.9-.86 1.08-.16.19-.31.2-.58.07-.28-.13-1.16-.43-2.2-1.37-.82-.73-1.37-1.63-1.53-1.9-.16-.28-.02-.43.12-.56.13-.13.28-.32.42-.48.13-.16.18-.28.28-.46.09-.19.05-.35 0-.48-.07-.13-.6-1.5-.83-2.03Z"
        fill="#fff"
      />
    </svg>
  );
}

export function InstagramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id="ig-g" x1="0" y1="40" x2="40" y2="0">
          <stop offset="0" stopColor="#FEDA75" />
          <stop offset="0.35" stopColor="#D62976" />
          <stop offset="0.7" stopColor="#962FBF" />
          <stop offset="1" stopColor="#4F5BD5" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#ig-g)" />
      <rect x="10.5" y="10.5" width="19" height="19" rx="6" stroke="#fff" strokeWidth="2" fill="none" />
      <circle cx="20" cy="20" r="5.2" stroke="#fff" strokeWidth="2" fill="none" />
      <circle cx="26.2" cy="13.8" r="1.4" fill="#fff" />
    </svg>
  );
}

export function FacebookIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#1877F2" />
      <path
        d="M22.4 30V21.1h3l.45-3.5h-3.45v-2.24c0-1 .28-1.7 1.72-1.7h1.84v-3.13A24.6 24.6 0 0 0 23.3 10c-2.66 0-4.48 1.62-4.48 4.6v2.99h-3v3.5h3V30h3.58Z"
        fill="#fff"
      />
    </svg>
  );
}

export function TiktokIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#000" />
      <path
        d="M25.5 11.5c.5 2.3 2 3.8 4.3 4v3.1c-1.5.1-2.9-.35-4.3-1.2v6.7c0 4.15-3.3 6.9-7 6.4-2.9-.4-5.1-2.85-5.1-5.75 0-3.2 2.6-5.85 5.9-5.85.35 0 .68.03 1 .1v3.25a3 3 0 0 0-1-.17 2.75 2.75 0 1 0 2.75 2.75v-13.3h3.45Z"
        fill="#fff"
      />
    </svg>
  );
}

export function MapsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="20" fill="#fff" />
      <circle cx="20" cy="20" r="19" fill="#fff" stroke="#e2dbec" strokeWidth="1" />
      <path
        d="M20 9c-4 0-7.2 3.1-7.2 7 0 5.3 7.2 15 7.2 15s7.2-9.7 7.2-15c0-3.9-3.2-7-7.2-7Z"
        fill="#EA4335"
      />
      <circle cx="20" cy="16" r="2.8" fill="#fff" />
    </svg>
  );
}
