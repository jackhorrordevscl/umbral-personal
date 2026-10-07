import { Globe } from 'lucide-react';
import { initials, safeWebsite } from '../../utils/public-profile';
import type { PublicTherapistProfile } from '../../api/publicScheduling';

interface ProfileCardProps {
  profile: PublicTherapistProfile;
  // La página pasa getPublicTherapistAvatarUrl(therapistId); solo se usa si
  // profile.hasAvatar es true.
  avatarUrl: string;
}

// Tarjeta presentacional pura (issue #155): la página decide si hay perfil y
// qué layout usar, así que acá siempre se renderiza. La bio se acota solo bajo
// lg para que no empuje el calendario fuera de la primera pantalla en móvil;
// el texto completo queda en el DOM (sin botón "ver más") y desde lg se ve
// entero porque la tarjeta es una columna lateral.
export default function ProfileCard({ profile, avatarUrl }: ProfileCardProps) {
  const website = safeWebsite(profile.website);

  return (
    <div className="card p-5 lg:p-6 flex flex-1 gap-4 lg:flex-col lg:items-stretch lg:gap-6">
      {profile.hasAvatar ? (
        <img
          src={avatarUrl}
          alt={profile.name}
          width={288}
          height={288}
          className="h-auto min-h-28 w-28 self-stretch lg:min-h-0 lg:w-full lg:self-auto lg:aspect-square rounded-xl object-cover flex-shrink-0"
        />
      ) : (
        <div className="h-auto min-h-28 w-28 self-stretch lg:min-h-0 lg:w-full lg:self-auto lg:aspect-square rounded-xl bg-sage-100 text-sage-700 font-display text-2xl lg:text-7xl flex items-center justify-center flex-shrink-0">
          {initials(profile.name)}
        </div>
      )}
      <div className="min-w-0">
        <h1 className="font-display text-2xl lg:text-3xl leading-tight text-slate-900">{profile.name}</h1>
        {profile.specialty && (
          <span className="inline-block mt-1 lg:mt-2 text-xs lg:text-sm bg-sage-50 text-sage-700 px-2 py-0.5 lg:px-3 lg:py-1 rounded-full">
            {profile.specialty}
          </span>
        )}
        {profile.bio && (
          <p className="mt-3 lg:mt-4 text-sm lg:text-base leading-relaxed text-slate-600 whitespace-pre-line line-clamp-4 lg:line-clamp-none">
            {profile.bio}
          </p>
        )}
        {website && (
          <a
            href={website.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 lg:mt-4 inline-flex items-center gap-1.5 text-sm lg:text-base text-sage-700 hover:underline break-all rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-400"
          >
            <Globe size={14} aria-hidden="true" />
            {website.label}
          </a>
        )}
      </div>
    </div>
  );
}
