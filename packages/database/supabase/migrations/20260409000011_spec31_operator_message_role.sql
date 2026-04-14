-- spec-31: Allow operator replies in customer_session_messages
-- Adds 'operator' to the allowed role values so operator replies
-- are distinguished from WISMO agent messages ('system').

ALTER TABLE public.customer_session_messages
  DROP CONSTRAINT IF EXISTS chk_session_message_role;

ALTER TABLE public.customer_session_messages
  ADD CONSTRAINT chk_session_message_role
    CHECK (role IN ('user', 'system', 'operator'));
