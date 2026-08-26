import { z } from 'zod';

export const queryParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'followUpDate']).default('createdAt'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

export const leadFilterSchema = z.object({
  fieldId: z.string().min(1),
  fieldType: z.enum(['string', 'number', 'date', 'boolean']),
  condition: z.enum([
    'is',
    'is not',
    'contain',
    'does not contain',
    'starts with',
    'ends with',
    'before',
    'after',
    'greater than',
    'less than',
    'is empty',
    'is not empty',
  ]),
  value: z.string().optional(),
  inputType: z.string().optional(),
});

export const queryLeadsBodySchema = z.object({
  q: z.string().optional(),
  logic: z.enum(['AND', 'OR']).optional(),
  filters: z.array(leadFilterSchema).optional(),
});
