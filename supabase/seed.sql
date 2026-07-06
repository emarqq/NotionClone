-- Seed data: default spaces

insert into spaces (id, name, slug, icon, position)
values
  ('11111111-1111-4111-8111-111111111111', 'School', 'school', 'GraduationCap', 'a0'),
  ('22222222-2222-4222-8222-222222222222', 'Work',   'work',   'Briefcase', 'a1')
on conflict do nothing;
