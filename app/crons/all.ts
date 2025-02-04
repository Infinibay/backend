import UpdateVmStatusJob from "./UpdateVmStatus";
import CheckRunningServicesJob from "./CheckRunningServices";
import UpdateGraphicsInformationJob from "./UpdateGraphicsInformation";

export async function startCrons() {
  UpdateVmStatusJob.start();
  CheckRunningServicesJob.start();
  UpdateGraphicsInformationJob.start();
}