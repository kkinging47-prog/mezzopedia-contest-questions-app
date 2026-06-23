-- Optional sample questions for local testing.
-- Create demo participants from the Admin dashboard so their passwords are hashed correctly.

insert into public.questions (category, phase, question_text, options, correct_option_id, points)
values
('Primary 6', 'Stage 1', 'What is 25 + 37?', '[{"id":"A","text":"52"},{"id":"B","text":"62"},{"id":"C","text":"72"},{"id":"D","text":"82"}]', 'B', 1),
('Primary 6', 'Stage 1', 'If 11 × 24 = ?', '[{"id":"A","text":"244"},{"id":"B","text":"264"},{"id":"C","text":"284"},{"id":"D","text":"304"}]', 'B', 1),
('Primary 6', 'Stage 1', 'Half of 96 is _____.', '[{"id":"A","text":"38"},{"id":"B","text":"42"},{"id":"C","text":"48"},{"id":"D","text":"56"}]', 'C', 1);
