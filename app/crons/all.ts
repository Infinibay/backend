import UpdateVmStatusJob from "./UpdateVmStatus";
import CheckRunningServicesJob from "./CheckRunningServices";
import UpdateGraphicsInformationJob from "./UpdateGraphicsInformation";
import FlushFirewallJob from "./flushFirewall"

export async function startCrons() {
  UpdateVmStatusJob.start();
  CheckRunningServicesJob.start();
  UpdateGraphicsInformationJob.start();
  FlushFirewallJob.start();
}