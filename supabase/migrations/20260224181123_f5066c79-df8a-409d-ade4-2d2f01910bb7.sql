-- Allow authenticated users to insert their own time_account_transactions (for ZA deductions)
CREATE POLICY "Users can insert own transactions"
ON public.time_account_transactions
FOR INSERT
WITH CHECK (auth.uid() = user_id AND auth.uid() = changed_by);

-- Allow authenticated users to update their own time_account balance (for ZA deductions)
CREATE POLICY "Users can update own time account"
ON public.time_accounts
FOR UPDATE
USING (auth.uid() = user_id);