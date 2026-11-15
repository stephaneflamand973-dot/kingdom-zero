// ─────────────────────────────────────────────────────────────
// Phase 9 — Création du personnage : atouts de départ.
// Chaque atout a un effet mécanique réel, appliqué par le moteur
// (apprentissage, faim, maladie, relations, rencontres…).
// ─────────────────────────────────────────────────────────────
import type { Character, PerkId } from './types';

export interface PerkDef { id: PerkId; name: string; description: string }

export const PERKS: PerkDef[] = [
  { id: 'esprit_vif', name: 'Esprit vif', description: 'Apprend tous les métiers et savoir-faire deux fois plus vite.' },
  { id: 'robuste', name: 'Robuste', description: 'Endurance +2, a faim 20 % moins vite, tombe deux fois moins souvent malade.' },
  { id: 'beau_parleur', name: 'Beau parleur', description: 'Charisme +2, Diplomatie +10, et les gens s’attachent à lui 50 % plus vite.' },
  { id: 'bras_solides', name: 'Bras solides', description: 'Force +3, Combat +12 : redoutable dans une rixe ou une embuscade.' },
  { id: 'main_verte', name: 'Main verte', description: 'Agriculture +15 : un bon journalier dès le premier jour aux champs.' },
  { id: 'fils_d_artisan', name: 'Fils d’artisan', description: 'Artisanat +12 : entre directement comme compagnon dans la plupart des ateliers.' },
  { id: 'pecule', name: 'Petit pécule', description: 'Arrive au village avec 60 deniers en poche au lieu de rien.' },
  { id: 'bonne_etoile', name: 'Né sous une bonne étoile', description: 'Deux fois moins de risques d’embuscade sur les routes.' },
];
export const MAX_PERKS = 2;

export const hasPerk = (c: Character | undefined, id: PerkId): boolean => !!c?.perks?.includes(id);

/** Applique les effets permanents de départ (attributs, compétences, bourse). */
export function applyStartingPerks(c: Character, perks: PerkId[]): void {
  c.perks = [...new Set(perks)].slice(0, MAX_PERKS);
  const cap = (v: number, max: number) => Math.min(max, v);
  for (const p of c.perks) {
    switch (p) {
      case 'robuste': c.attributes.endurance = cap(c.attributes.endurance + 2, 10); break;
      case 'beau_parleur': c.attributes.charisme = cap(c.attributes.charisme + 2, 10); c.skills.diplomatie += 10; break;
      case 'bras_solides': c.attributes.force = cap(c.attributes.force + 3, 10); c.skills.combat += 12; break;
      case 'main_verte': c.skills.agriculture += 15; break;
      case 'fils_d_artisan': c.skills.artisanat += 12; break;
      case 'pecule': c.money += 60; break;
      default: break;
    }
  }
}
