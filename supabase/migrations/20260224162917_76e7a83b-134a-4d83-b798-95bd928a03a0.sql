
-- =============================================
-- 1. LEAVE BALANCES - Urlaubskontingent pro Mitarbeiter/Jahr
-- =============================================
CREATE TABLE public.leave_balances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  year INTEGER NOT NULL DEFAULT EXTRACT(year FROM now()),
  total_days NUMERIC NOT NULL DEFAULT 25,
  used_days NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, year)
);

ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own leave balance"
  ON public.leave_balances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all leave balances"
  ON public.leave_balances FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert leave balances"
  ON public.leave_balances FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update leave balances"
  ON public.leave_balances FOR UPDATE
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete leave balances"
  ON public.leave_balances FOR DELETE
  USING (has_role(auth.uid(), 'administrator'));

-- =============================================
-- 2. LEAVE REQUESTS - Urlaubsanträge
-- =============================================
CREATE TABLE public.leave_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days NUMERIC NOT NULL DEFAULT 1,
  type TEXT NOT NULL DEFAULT 'urlaub',
  status TEXT NOT NULL DEFAULT 'beantragt',
  notizen TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own leave requests"
  ON public.leave_requests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own leave requests"
  ON public.leave_requests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own pending leave requests"
  ON public.leave_requests FOR DELETE
  USING (auth.uid() = user_id AND status = 'beantragt');

CREATE POLICY "Admins can view all leave requests"
  ON public.leave_requests FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update all leave requests"
  ON public.leave_requests FOR UPDATE
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can delete all leave requests"
  ON public.leave_requests FOR DELETE
  USING (has_role(auth.uid(), 'administrator'));

-- =============================================
-- 3. TIME ACCOUNTS - Zeitkonto pro Mitarbeiter
-- =============================================
CREATE TABLE public.time_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  balance_hours NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.time_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own time account"
  ON public.time_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all time accounts"
  ON public.time_accounts FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert time accounts"
  ON public.time_accounts FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can update time accounts"
  ON public.time_accounts FOR UPDATE
  USING (has_role(auth.uid(), 'administrator'));

-- =============================================
-- 4. TIME ACCOUNT TRANSACTIONS - Audit-Log
-- =============================================
CREATE TABLE public.time_account_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  changed_by UUID NOT NULL,
  change_type TEXT NOT NULL,
  hours NUMERIC NOT NULL,
  balance_before NUMERIC NOT NULL,
  balance_after NUMERIC NOT NULL,
  reason TEXT,
  reference_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.time_account_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON public.time_account_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all transactions"
  ON public.time_account_transactions FOR SELECT
  USING (has_role(auth.uid(), 'administrator'));

CREATE POLICY "Admins can insert transactions"
  ON public.time_account_transactions FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'administrator'));

-- Triggers for updated_at
CREATE TRIGGER update_leave_balances_updated_at
  BEFORE UPDATE ON public.leave_balances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_leave_requests_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_time_accounts_updated_at
  BEFORE UPDATE ON public.time_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
