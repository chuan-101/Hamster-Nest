import type { User } from "@supabase/supabase-js";
import HomePage from "./HomePage";

type HomeLayoutSettingsPageProps = {
  user: User | null;
  onOpenChat: () => void;
};

const HomeLayoutSettingsPage = ({
  user,
  onOpenChat,
}: HomeLayoutSettingsPageProps) => (
  <HomePage user={user} onOpenChat={onOpenChat} mode="settings" />
);

export default HomeLayoutSettingsPage;
