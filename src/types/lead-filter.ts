export type FilterFieldType = 'string' | 'number' | 'date' | 'boolean';

export type FilterCondition =
  | 'is'
  | 'is not'
  | 'contain'
  | 'does not contain'
  | 'starts with'
  | 'ends with'
  | 'before'
  | 'after'
  | 'greater than'
  | 'less than'
  | 'is empty'
  | 'is not empty';

export interface LeadFilter {
  fieldId: string;
  fieldType: FilterFieldType;
  condition: FilterCondition;
  value?: string;
  inputType?: 'text' | 'select' | 'multiselect' | string;
}

export interface QueryLeadsBody {
  q?: string;
  logic?: 'AND' | 'OR';
  filters?: LeadFilter[];
}

export type CurrentUser = {
  tenantId: string;
  userId: string;
  role: 'owner' | 'admin' | 'manager' | 'agent';
};

// Maps public fieldId -> actual leads column
export const SYSTEM_FIELD_COLUMNS: Record<string, string> = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  assignedTo: 'assigned_to',
  createdBy: 'user_id',
  followUpDate: 'follow_up_date',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

export const DATE_SYSTEM_FIELDS = new Set(['followUpDate', 'createdAt', 'updatedAt']);
export const AGENT_SYSTEM_FIELDS = new Set(['assignedTo', 'createdBy']);

declare global {
  namespace Express {
    interface Request {
      currentUser?: CurrentUser;
    }
  }
}
