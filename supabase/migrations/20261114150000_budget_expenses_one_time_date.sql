-- One-time expenses store their payment date here.
-- Nullable, with no default and no backfill, so existing rows are not rewritten.
ALTER TABLE public.budget_expenses
  ADD COLUMN one_time_date date;

-- budget_expenses_input_mode_check currently allows only Weekly, Monthly, and CC_Link.
-- One_Time has to be added or a one-time row cannot be saved. Existing values still pass.
ALTER TABLE public.budget_expenses
  DROP CONSTRAINT budget_expenses_input_mode_check;

ALTER TABLE public.budget_expenses
  ADD CONSTRAINT budget_expenses_input_mode_check
  CHECK (input_mode = ANY (ARRAY['Weekly'::text, 'Monthly'::text, 'CC_Link'::text, 'One_Time'::text]));
