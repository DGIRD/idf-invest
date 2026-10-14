import type { Contact, Insert, Patch, Property, PropertyTask, Scenario, Tables, TableName, TimelineEvent, UserSettings, VersionedTable } from './types.ts';

export interface SessionInfo {
  userId: string;
  email: string;
}

export interface Snapshot {
  properties: Property[];
  scenarios: Scenario[];
  contacts: Contact[];
  tasks: PropertyTask[];
  events: TimelineEvent[];
  settings: UserSettings | null;
  loadedAt: string;
}

export type UpdateResult<T> =
  | { status: 'ok'; row: T }
  | { status: 'conflict'; current: T }
  | { status: 'missing' };

export class RepoError extends Error {
  constructor(message: string, override readonly cause?: unknown, readonly offline = false) {
    super(message);
  }
}

export interface Repo {
  readonly mode: 'supabase' | 'demo';
  getSession(): Promise<SessionInfo | null>;
  onAuthChange(cb: (s: SessionInfo | null, event: string) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<'session' | 'confirm_email'>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;

  loadAll(): Promise<Snapshot>;
  insert<T extends TableName>(table: T, row: Insert<Tables[T]>): Promise<Tables[T]>;
  insertMany<T extends TableName>(table: T, rows: Insert<Tables[T]>[]): Promise<Tables[T][]>;
  /** Mise à jour conditionnée à la version lue : jamais d'écrasement silencieux. */
  update<T extends VersionedTable>(table: T, id: string, version: number, patch: Patch<Tables[T]>): Promise<UpdateResult<Tables[T]>>;
  remove(table: TableName, id: string): Promise<void>;
  saveSettings(version: number, patch: Partial<Pick<UserSettings, 'simulator_defaults' | 'ui_prefs'>>): Promise<UpdateResult<UserSettings>>;
}

/** Message lisible pour une erreur PostgREST / réseau. */
export function describeError(e: unknown): string {
  if (e instanceof RepoError) return e.message;
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Serveur injoignable : vérifiez votre connexion. Rien n’a été enregistré.';
  if (/row-level security|permission denied/i.test(msg)) return 'Action refusée par le serveur (droits insuffisants).';
  if (/violates check constraint/i.test(msg)) return 'Une valeur ne respecte pas les règles de saisie.';
  if (/violates foreign key/i.test(msg)) return 'Élément lié introuvable (supprimé entre-temps ?).';
  if (/schema cache/i.test(msg)) return `La base de données n’est pas à jour : une migration SQL reste à exécuter dans Supabase (${msg}).`;
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(msg)) return 'Adresse e-mail non confirmée : ouvrez le lien reçu par e-mail.';
  return msg;
}
