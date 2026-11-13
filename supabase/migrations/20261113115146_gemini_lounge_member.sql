insert into public.lounge_members (sender, display_name, emoji, color)
values ('gemini_cli', 'Gemini CLI', '✦', '#547EA3')
on conflict (sender) do nothing;
