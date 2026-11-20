import AuthenticatedDashboard from "../AuthenticatedDashboard";
import { deploymentVersion } from "@/lib/deployment-version";

export const dynamic = "force-dynamic";
export const metadata = { title: "桌面组件授权 · 序流" };

export default function DesktopWidgetPage() {
  return <AuthenticatedDashboard deploymentVersion={deploymentVersion()} desktopWidget />;
}
