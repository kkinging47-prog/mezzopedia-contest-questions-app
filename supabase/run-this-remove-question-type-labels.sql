-- Remove visible topic/type labels from seeded question text.
-- Safe to run more than once. It only removes leading labels such as [Algebra], [Aptitude], [Statistics], [Geometry].

update public.questions
set question_text = regexp_replace(question_text, '^\[(Algebra|Aptitude|Statistics|Geometry)\]\s+', '', 'i'),
    updated_at = now()
where question_text ~* '^\[(Algebra|Aptitude|Statistics|Geometry)\]\s+';
