import type {
  Allocation, Contact, DepositMovement, DocumentRow, Expense, Insert, Lease, LeaseTenant, OutboxMessage, Patch, Payment, Property, PropertyTask,
  Receipt, Reminder, RentCharge, Scenario, Tables, TableName, Tenant, TimelineEvent, UserSettings, VersionedTable,
} from './types.ts';

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
  tenants: Tenant[];
  leases: Lease[];
  leaseTenants: LeaseTenant[];
  charges: RentCharge[];
  payments: Payment[];
  allocations: Allocation[];
  deposits: DepositMovement[];
  receipts: Receipt[];
  reminders: Reminder[];
  documents: DocumentRow[];
  expenses: Expense[];
  outbox: OutboxMessage[];
  settings: UserSettings | null;
  /** Tables absentes côté serveur (migration non appliquée). */
  missingTables: string[];
  loadedAt: string;
}

export const EMPTY_SNAPSHOT: Snapshot = {
  properties: [], scenarios: [], contacts: [], tasks: [], events: [], tenants: [], leases: [], leaseTenants: [], charges: [], payments: [],
  allocations: [], deposits: [], receipts: [], reminders: [], documents: [], expenses: [], outbox: [], settings: null, missingTables: [], loadedAt: '',
};

/** Correspondance table serveur → liste du Snapshot. */
export const SNAPSHOT_KEY = {
  properties: 'properties', scenarios: 'scenarios', pro_contacts: 'contacts', property_tasks: 'tasks', timeline_events: 'events',
  tenants: 'tenants', leases: 'leases', lease_tenants: 'leaseTenants', rent_charges: 'charges', payments: 'payments',
  payment_allocations: 'allocations', deposit_movements: 'deposits', reminders: 'reminders', documents: 'documents', expenses: 'expenses',
} as const satisfies Record<TableName, keyof Snapshot>;

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
  /** Mise à jour d'une table sans version (ex. départ d'un colocataire). */
  updateWhere<T extends TableName>(table: T, match: Record<string, string>, patch: Patch<Tables[T]>): Promise<void>;
  remove(table: TableName, id: string): Promise<void>;
  removeWhere(table: TableName, match: Record<string, string>): Promise<void>;
  saveSettings(version: number, patch: Partial<Pick<UserSettings, 'simulator_defaults' | 'ui_prefs' | 'rental_settings'>>): Promise<UpdateResult<UserSettings>>;

  // Fonctions serveur (gestion locative)
  generateCharges(leaseId: string, until?: string): Promise<number>;
  issueReceipt(chargeId: string, kind: Receipt['kind']): Promise<Receipt>;
  cancelReceipt(receiptId: string, reason: string): Promise<Receipt>;
  queueReceiptEmail(receiptId: string): Promise<void>;
  queueReminder(reminderId: string): Promise<Reminder>;

  // Fichiers privés
  uploadFile(path: string, file: Blob, contentType: string): Promise<void>;
  /** Lien temporaire (durée en secondes) vers un fichier privé. */
  fileUrl(path: string, seconds: number): Promise<string>;
  removeFile(path: string): Promise<void>;
}

/** Message lisible pour une erreur PostgREST / réseau. */
export function describeError(e: unknown): string {
  if (e instanceof RepoError) return e.message;
  const msg = (e as { message?: string })?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Serveur injoignable : vérifiez votre connexion. Rien n’a été enregistré.';
  if (/row-level security|permission denied/i.test(msg)) return 'Action refusée par le serveur (droits insuffisants).';
  if (/violates check constraint/i.test(msg)) return 'Une valeur ne respecte pas les règles de saisie.';
  if (/violates foreign key/i.test(msg)) return 'Élément lié introuvable (supprimé entre-temps ?).';
  if (/duplicate key|unique constraint/i.test(msg)) return 'Cet élément existe déjà.';
  if (/schema cache/i.test(msg)) return `La base de données n’est pas à jour : une migration SQL reste à exécuter dans Supabase (${msg}).`;
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(msg)) return 'Adresse e-mail non confirmée : ouvrez le lien reçu par e-mail.';
  return msg;
}
