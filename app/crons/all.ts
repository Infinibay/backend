import UpdateVmStatusJob from "./UpdateVmStatus";

export async function startCrons() {
  UpdateVmStatusJob.start();
}