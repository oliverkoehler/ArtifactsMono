const http = require("http");

const PORT = Number.parseInt(process.env.PORT || "9104", 10);
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

function dockerRequest(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: DOCKER_SOCKET,
        path: pathname,
        method: "GET",
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Docker API ${pathname} returned ${response.statusCode}: ${body}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Docker API ${pathname} returned invalid JSON: ${error.message}`));
          }
        });
      }
    );

    request.on("error", reject);
    request.end();
  });
}

function sanitizeLabelValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function formatLabels(labels) {
  const entries = Object.entries(labels)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}="${sanitizeLabelValue(value)}"`);

  return entries.length > 0 ? `{${entries.join(",")}}` : "";
}

function metric(name, help, type, samples) {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];

  for (const sample of samples) {
    lines.push(`${name}${formatLabels(sample.labels)} ${sample.value}`);
  }

  return lines.join("\n");
}

function sumBlkio(entries, operation) {
  if (!Array.isArray(entries)) {
    return 0;
  }

  return entries.reduce((total, entry) => {
    if (!entry || entry.op !== operation) {
      return total;
    }

    return total + Number(entry.value || 0);
  }, 0);
}

function cpuPercent(stats) {
  const cpuStats = stats.cpu_stats || {};
  const precpuStats = stats.precpu_stats || {};
  const cpuUsage = cpuStats.cpu_usage || {};
  const preCpuUsage = precpuStats.cpu_usage || {};

  const cpuDelta = Number(cpuUsage.total_usage || 0) - Number(preCpuUsage.total_usage || 0);
  const systemDelta =
    Number(cpuStats.system_cpu_usage || 0) - Number(precpuStats.system_cpu_usage || 0);
  const onlineCpus =
    Number(cpuStats.online_cpus || 0) ||
    (Array.isArray(cpuUsage.percpu_usage) ? cpuUsage.percpu_usage.length : 1);

  if (cpuDelta <= 0 || systemDelta <= 0 || onlineCpus <= 0) {
    return 0;
  }

  return (cpuDelta / systemDelta) * onlineCpus * 100;
}

async function collectMetrics() {
  const containers = await dockerRequest("/containers/json");
  return Promise.all(
    containers.map(async (container) => {
      const [stats, inspect] = await Promise.all([
        dockerRequest(`/containers/${container.Id}/stats?stream=false`),
        dockerRequest(`/containers/${container.Id}/json?size=true`),
      ]);

      const containerName =
        (Array.isArray(container.Names) && container.Names[0] ? container.Names[0] : container.Id)
          .replace(/^\//, "");
      const labels = inspect.Config?.Labels || {};
      const baseLabels = {
        container_id: container.Id,
        container_name: containerName,
        image: container.Image || "",
        service: labels["com.docker.compose.service"] || "",
        status: inspect.State?.Status || "",
      };

      const memoryUsage = Number(stats.memory_stats?.usage || 0);
      const memoryLimit = Number(stats.memory_stats?.limit || 0);
      const sizeRw = Number(inspect.SizeRw || 0);
      const sizeRootFs = Number(inspect.SizeRootFs || 0);
      const blkioEntries = stats.blkio_stats?.io_service_bytes_recursive || [];

      return {
        labels: baseLabels,
        cpuPercent: cpuPercent(stats),
        memoryUsage,
        memoryLimit,
        memoryPercent: memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0,
        diskUsage: sizeRw,
        rootFsSize: sizeRootFs,
        diskReadBytes: sumBlkio(blkioEntries, "Read"),
        diskWriteBytes: sumBlkio(blkioEntries, "Write"),
      };
    })
  );
}

function renderMetrics(containerMetrics) {
  return [
    metric(
      "docker_container_cpu_percent",
      "CPU usage percentage reported from Docker stats.",
      "gauge",
      containerMetrics.map((entry) => ({
        labels: entry.labels,
        value: entry.cpuPercent,
      }))
    ),
    metric(
      "docker_container_memory_usage_bytes",
      "Current memory usage in bytes reported from Docker stats.",
      "gauge",
      containerMetrics.map((entry) => ({
        labels: entry.labels,
        value: entry.memoryUsage,
      }))
    ),
    metric(
      "docker_container_memory_limit_bytes",
      "Configured memory limit in bytes reported from Docker stats.",
      "gauge",
      containerMetrics.map((entry) => ({
        labels: entry.labels,
        value: entry.memoryLimit,
      }))
    ),
    metric(
      "docker_container_memory_percent",
      "Memory usage percentage derived from Docker stats.",
      "gauge",
      containerMetrics.map((entry) => ({
        labels: entry.labels,
        value: entry.memoryPercent,
      }))
    ),
    metric(
      "docker_container_disk_usage_bytes",
      "Writable layer size in bytes reported by Docker inspect.",
      "gauge",
      containerMetrics.map((entry) => ({
        labels: entry.labels,
        value: entry.diskUsage,
      }))
    ),
    metric(
      "docker_container_rootfs_size_bytes",
      "Container root filesystem size in bytes reported by Docker inspect.",
      "gauge",
      containerMetrics.map((entry) => ({
        labels: entry.labels,
        value: entry.rootFsSize,
      }))
    ),
    metric(
      "docker_container_disk_read_bytes_total",
      "Total bytes read from block devices reported by Docker stats.",
      "gauge",
      containerMetrics.map((entry) => ({
        labels: entry.labels,
        value: entry.diskReadBytes,
      }))
    ),
    metric(
      "docker_container_disk_write_bytes_total",
      "Total bytes written to block devices reported by Docker stats.",
      "gauge",
      containerMetrics.map((entry) => ({
        labels: entry.labels,
        value: entry.diskWriteBytes,
      }))
    ),
  ].join("\n\n");
}

const server = http.createServer(async (request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("ok");
    return;
  }

  if (request.url !== "/metrics") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  try {
    const containerMetrics = await collectMetrics();
    response.writeHead(200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(renderMetrics(containerMetrics));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`# exporter_error ${sanitizeLabelValue(error.message)}\n`);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`docker-metrics-exporter listening on ${PORT}`);
});
