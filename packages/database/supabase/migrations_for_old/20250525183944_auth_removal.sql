create schema if not exists "authenticative";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION authenticative.is_user_authenticated()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT array[(select auth.jwt()->>'aal')] <@ (
    SELECT
      CASE
        WHEN count(id) > 0 THEN array['aal2']
        ELSE array['aal1', 'aal2']
      END as aal
    FROM auth.mfa_factors
    WHERE (auth.uid() = user_id)
    AND status = 'verified'
  );
$function$
;


drop policy "Owner can do everything" on "public"."todo_list";

create policy "Owner can do everything"
on "public"."todo_list"
as permissive
for all
to authenticated
using ((authenticative.is_user_authenticated() AND (owner = auth.uid())));



drop policy "Give users access to own folder 1m0cqf_0" on "storage"."objects";

drop policy "Give users access to own folder 1m0cqf_1" on "storage"."objects";

drop policy "Give users access to own folder 1m0cqf_2" on "storage"."objects";

drop policy "Give users access to own folder 1m0cqf_3" on "storage"."objects";

create policy "Give users access to own folder 1m0cqf_0"
on "storage"."objects"
as permissive
for delete
to public
using (((bucket_id = 'files'::text) AND authenticative.is_user_authenticated() AND (name ~ (('^'::text || (auth.uid())::text) || '/'::text))));


create policy "Give users access to own folder 1m0cqf_1"
on "storage"."objects"
as permissive
for update
to public
using (((bucket_id = 'files'::text) AND authenticative.is_user_authenticated() AND (name ~ (('^'::text || (auth.uid())::text) || '/'::text))));


create policy "Give users access to own folder 1m0cqf_2"
on "storage"."objects"
as permissive
for insert
to public
with check (((bucket_id = 'files'::text) AND authenticative.is_user_authenticated() AND (name ~ (('^'::text || (auth.uid())::text) || '/'::text))));


create policy "Give users access to own folder 1m0cqf_3"
on "storage"."objects"
as permissive
for select
to public
using (((bucket_id = 'files'::text) AND authenticative.is_user_authenticated() AND (name ~ (('^'::text || (auth.uid())::text) || '/'::text))));



