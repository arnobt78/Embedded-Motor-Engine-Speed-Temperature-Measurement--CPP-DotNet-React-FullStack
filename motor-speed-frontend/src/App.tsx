import AlertSystem from "./components/AlertSystem";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import AnimatedMotor from "./components/AnimatedMotor";
import ColorLegend from "./components/ColorLegend";
import DailyLifeApplications from "./components/DailyLifeApplications";
import DashboardStatsComponent from "./components/DashboardStats";
import IndustrialManagementDashboard from "./components/IndustrialManagementDashboard";
import IoTCloudIntegration from "./components/IoTCloudIntegration";
import MobileDashboard from "./components/MobileDashboard";
import MotorChart from "./components/MotorChart";
import MotorSpinner from "./components/MotorSpinner";
import NavBar from "./components/NavBar";
import ReadingList from "./components/ReadingList";
import SensorDashboard from "./components/SensorDashboard";
import SettingsModal from "./components/SettingsModal";
import { safeDate } from "./lib/dateUtils";
import { API_BASE_URL, SIGNALR_URL } from "./services/api";
import type { MotorReading, Alert, DashboardStats } from "./types";
import * as signalR from "@microsoft/signalr";
import axios from "axios";
import { useEffect, useState } from "react";

function App() {
  const [readings, setReadings] = useState<MotorReading[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(
    null
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [alert, setAlert] = useState("");
  const [loading, setLoading] = useState(true);
  const [signalRConnected, setSignalRConnected] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [fastSpinCount, setFastSpinCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [maxReadings, setMaxReadings] = useState(100);
  const [isGenerating, setIsGenerating] = useState(false);

  // CSV export helper
  function exportCsv() {
    if (!readings.length) return;
    const header =
      "ID,Speed (RPM),Temperature (°C),Timestamp,Title,MachineId,Status," +
      "VibrationX,VibrationY,VibrationZ,Vibration," +
      "OilPressure,AirPressure,HydraulicPressure," +
      "CoolantFlowRate,FuelFlowRate," +
      "Voltage,Current,PowerFactor,PowerConsumption," +
      "RPM,Torque,Efficiency," +
      "Humidity,AmbientTemperature,AmbientPressure," +
      "ShaftPosition,Displacement," +
      "StrainGauge1,StrainGauge2,StrainGauge3," +
      "SoundLevel,BearingHealth," +
      "OperatingHours,MaintenanceStatus,SystemHealth";
    const rows = readings.map(
      (r) =>
        `${r.id},${r.speed},${r.temperature},${r.timestamp},${r.title || ""},${
          r.machineId
        },${r.status},${r.vibrationX || ""},${r.vibrationY || ""},${
          r.vibrationZ || ""
        },${r.vibration || ""},${r.oilPressure || ""},${r.airPressure || ""},${
          r.hydraulicPressure || ""
        },${r.coolantFlowRate || ""},${r.fuelFlowRate || ""},${
          r.voltage || ""
        },${r.current || ""},${r.powerFactor || ""},${
          r.powerConsumption || ""
        },${r.rpm || ""},${r.torque || ""},${r.efficiency || ""},${
          r.humidity || ""
        },${r.ambientTemperature || ""},${r.ambientPressure || ""},${
          r.shaftPosition || ""
        },${r.displacement || ""},${r.strainGauge1 || ""},${
          r.strainGauge2 || ""
        },${r.strainGauge3 || ""},${r.soundLevel || ""},${
          r.bearingHealth || ""
        },${r.operatingHours || ""},${r.maintenanceStatus || ""},${
          r.systemHealth || ""
        }`
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "motor_readings.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Compute highest/lowest temp and RPM notifications
  const highestTemp = readings.length
    ? readings.reduce((a, b) => (a.temperature > b.temperature ? a : b))
    : null;
  const lowestTemp = readings.length
    ? readings.reduce((a, b) => (a.temperature < b.temperature ? a : b))
    : null;
  const highestRpm = readings.length
    ? readings.reduce((a, b) => (a.speed > b.speed ? a : b))
    : null;
  const lowestRpm = readings.length
    ? readings.reduce((a, b) => (a.speed < b.speed ? a : b))
    : null;

  // Load dashboard stats
  const loadDashboardStats = async () => {
    try {
      const response = await axios.get<DashboardStats>(
        `${API_BASE_URL}/api/motor/stats`
      );
      setDashboardStats(response.data);
    } catch (error) {
      console.error("Failed to load dashboard stats:", error);
    }
  };

  // Acknowledge alert
  const acknowledgeAlert = (alertId: string) => {
    setAlerts((prev) =>
      prev.map((alert) =>
        alert.id === alertId ? { ...alert, acknowledged: true } : alert
      )
    );
  };

  // Load readings
  useEffect(() => {
    axios
      .get<MotorReading[]>(`${API_BASE_URL}/api/motor`)
      .then((res) => {
        setReadings(res.data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false); // still hide spinner on error
      });

    loadDashboardStats();

    const hub = new signalR.HubConnectionBuilder()
      .withUrl(SIGNALR_URL)
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          if (retryContext.previousRetryCount === 0) {
            return 0; // Start immediately on first retry
          }
          return Math.min(
            1000 * Math.pow(2, retryContext.previousRetryCount),
            30000
          ); // Exponential backoff, max 30s
        },
      })
      .configureLogging(signalR.LogLevel.Information)
      .build();

    // New reading event
    hub.on("NewReading", (reading: MotorReading) => {
      setReadings((r) => {
        // Check if reading with same ID already exists
        const existingIndex = r.findIndex(
          (existing) => existing.id === reading.id
        );
        if (existingIndex !== -1) {
          // Replace existing reading with same ID
          const newReadings = [...r];
          newReadings[existingIndex] = reading;
          return newReadings;
        } else {
          // Add new reading to front, but also check for duplicate timestamps
          const duplicateTimestamp = r.find(
            (existing) => existing.timestamp === reading.timestamp
          );
          if (duplicateTimestamp) {
            // If same timestamp, replace the existing one
            const timestampIndex = r.findIndex(
              (existing) => existing.timestamp === reading.timestamp
            );
            const newReadings = [...r];
            newReadings[timestampIndex] = reading;
            return newReadings;
          } else {
            // Add new reading to front
            return [reading, ...r].slice(0, maxReadings);
          }
        }
      });

      // Refresh dashboard stats when new reading is added
      loadDashboardStats();

      if (reading.temperature > 80)
        setAlert(`⚠️ High Temp: ${reading.temperature} °C`);
    });

    // New alert event
    hub.on("NewAlert", (alert: Alert) => {
      setAlerts((prev) => {
        // Check if alert with same ID already exists
        const existingAlert = prev.find((a) => a.id === alert.id);
        if (existingAlert) {
          return prev; // Don't add duplicate
        }

        return [alert, ...prev];
      });
    });

    // Add connection event handlers
    hub.onclose(() => {
      setSignalRConnected(false);
    });

    hub.onreconnecting(() => {
      setSignalRConnected(false);
    });

    hub.onreconnected(() => {
      setSignalRConnected(true);
    });

    // Start connection
    setTimeout(() => {
      hub
        .start()
        .then(() => {
          setSignalRConnected(true);
        })
        .catch(() => {
          setSignalRConnected(false);
        });
    }, 100);

    return () => {
      hub.stop().catch(console.error);
    };
  }, [maxReadings]);

  return (
    <div
      className={`min-h-screen bg-gray-50 p-6${
        darkMode ? " dark bg-gray-900 text-white" : ""
      }`}
    >
      {loading && (
        <div className="fixed inset-0 flex items-center justify-center bg-white bg-opacity-80 z-50">
          <MotorSpinner />
        </div>
      )}

      <AlertSystem alerts={alerts} onAcknowledge={acknowledgeAlert} />

      <div className="max-w-9xl mx-auto">
        <NavBar />

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-4">
              <h1 className="text-3xl font-bold text-gray-900">
                Industrial IoT Platform for Motor Speed Monitoring
              </h1>
              <div
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  signalRConnected
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                    : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                }`}
              >
                {signalRConnected ? "🟢 Live" : "🔴 Offline"}
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                className="px-3 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors duration-200"
                onClick={() => setSettingsOpen(true)}
                title="Settings"
              >
                ⚙️
              </button>
            </div>
          </div>

          {/* Dashboard Stats */}
          {dashboardStats && <DashboardStatsComponent stats={dashboardStats} />}
        </div>

        {/* Hero Section - Motor Status Dashboard */}
        <div className="mb-8 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-800 dark:to-gray-900 rounded-2xl p-8 shadow-xl border border-blue-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                Motor Speed Monitoring Dashboard
              </h2>
              <p className="text-gray-600 dark:text-gray-300">
                Real-time monitoring and control
              </p>
            </div>

            {/* Motor Control Button - Redesigned */}
            <div className="relative">
              <button
                className={`px-8 py-4 rounded-2xl transition-all duration-300 font-semibold shadow-xl hover:shadow-2xl transform hover:scale-105 flex items-center space-x-4 ${
                  isGenerating
                    ? "bg-gradient-to-r from-gray-400 to-gray-500 cursor-not-allowed"
                    : readings[0]
                    ? "bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
                    : "bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600"
                } text-white`}
                onClick={() => {
                  if (isGenerating) return;
                  setIsGenerating(true);
                  axios.get(`${API_BASE_URL}/api/motor/sample`);
                  setFastSpinCount((c) => c + 1);
                  setTimeout(() => setIsGenerating(false), 1000);
                }}
              >
                {/* Gear Icon */}
                <div className="w-10 h-10 flex items-center justify-center">
                  {readings[0] ? (
                    <div className="relative">
                      <div className="w-8 h-8 border-4 border-white rounded-full animate-spin">
                        <div className="w-2 h-2 bg-white rounded-full absolute top-0 left-1/2 transform -translate-x-1/2"></div>
                        <div className="w-2 h-2 bg-white rounded-full absolute bottom-0 left-1/2 transform -translate-x-1/2"></div>
                        <div className="w-2 h-2 bg-white rounded-full absolute left-0 top-1/2 transform -translate-y-1/2"></div>
                        <div className="w-2 h-2 bg-white rounded-full absolute right-0 top-1/2 transform -translate-y-1/2"></div>
                      </div>
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 rounded-full animate-pulse"></div>
                    </div>
                  ) : (
                    <div className="w-8 h-8 border-4 border-white rounded-full">
                      <div className="w-2 h-2 bg-white rounded-full absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"></div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-start">
                  <span className="text-lg font-bold">
                    {readings[0] ? "Generate Reading" : "Start Motor"}
                  </span>
                  {readings[0] && (
                    <span className="text-sm opacity-90">
                      Current: {readings[0].speed} RPM
                    </span>
                  )}
                </div>
              </button>

              {/* Status Indicator */}
              {readings[0] && (
                <div className="absolute -top-3 -right-3 bg-green-500 text-white text-xs px-3 py-1 rounded-full font-bold animate-pulse shadow-lg">
                  LIVE
                </div>
              )}
            </div>
          </div>

          {/* Main Motor Visualization */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
            {/* Left: Motor Status Card */}
            <div className="lg:col-span-1">
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
                <div className="text-center">
                  <div className="mb-4">
                    <AnimatedMotor
                      reading={readings[0] || null}
                      className="mx-auto"
                    />
                  </div>
                  <div className="text-2xl font-bold mb-2">
                    <span
                      className={`px-4 py-2 rounded-full text-sm font-semibold ${
                        readings[0]?.status === "critical"
                          ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                          : readings[0]?.status === "warning"
                          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                          : readings[0]?.status === "maintenance"
                          ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                          : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                      }`}
                    >
                      {readings[0]?.status?.toUpperCase() || "OFFLINE"}
                    </span>
                  </div>
                  <p className="text-gray-600 dark:text-gray-300 text-sm">
                    Motor Speed Monitoring
                  </p>
                </div>
              </div>
            </div>

            {/* Center: Key Metrics */}
            <div className="lg:col-span-2">
              <div className="grid grid-cols-2 gap-4">
                {/* Speed */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                      <span className="text-2xl">⚡</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Motor Speed
                      </p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {readings[0]?.speed || 0} RPM
                      </p>
                    </div>
                  </div>
                </div>

                {/* Temperature */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900 rounded-full flex items-center justify-center">
                      <span className="text-2xl">🌡️</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Motor Temperature
                      </p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {readings[0]?.temperature || 0}°C
                      </p>
                    </div>
                  </div>
                </div>

                {/* Vibration */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center">
                      <span className="text-2xl">📳</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Motor Vibration
                      </p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {readings[0]?.vibration || 0} mm/s
                      </p>
                    </div>
                  </div>
                </div>

                {/* Efficiency */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                      <span className="text-2xl">⚙️</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        Motor Efficiency
                      </p>
                      <p className="text-2xl font-bold text-gray-900 dark:text-white">
                        {readings[0]?.efficiency || 0}%
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Chart Section */}
          <div className="lg:col-span-3">
            <MotorChart readings={readings} />
          </div>

          {/* Right Sidebar with Motor Animation and Notifications */}
          <div className="space-y-6">
            {/* Motor Animation */}
            {/* {readings[0] && <AnimatedMotor rpm={readings[0].speed} />} */}

            {/* Notifications */}
            <div className="space-y-3">
              {highestTemp && (
                <div className="p-3 bg-red-50 text-red-800 border border-red-200 rounded-lg shadow-sm">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">🌡️</span>
                    <div className="flex-1">
                      <div className="font-semibold text-sm">
                        Highest Temp: {highestTemp.temperature}°C
                      </div>
                      <div className="text-xs text-red-600">
                        {(() => {
                          const d = safeDate(highestTemp.timestamp);
                          return d ? d.toLocaleString() : "Invalid Date";
                        })()}
                      </div>
                      <div className="text-xs mt-1">
                        {highestTemp.temperature > 85 ? (
                          <span className="text-red-700 font-medium">
                            🚨 Critical: Above 85°C threshold
                          </span>
                        ) : highestTemp.temperature > 75 ? (
                          <span className="text-orange-600 font-medium">
                            ⚠️ Warning: Above 75°C threshold
                          </span>
                        ) : (
                          <span className="text-green-600 font-medium">
                            ✅ Normal: Below 75°C threshold
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {lowestTemp && (
                <div className="p-3 bg-green-50 text-green-800 border border-green-200 rounded-lg shadow-sm">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">❄️</span>
                    <div className="flex-1">
                      <div className="font-semibold text-sm">
                        Lowest Temp: {lowestTemp.temperature}°C
                      </div>
                      <div className="text-xs text-green-600">
                        {(() => {
                          const d = safeDate(lowestTemp.timestamp);
                          return d ? d.toLocaleString() : "Invalid Date";
                        })()}
                      </div>
                      <div className="text-xs mt-1">
                        {lowestTemp.temperature < 30 ? (
                          <span className="text-blue-600 font-medium">
                            ❄️ Cold: Below 30°C - Check heating
                          </span>
                        ) : lowestTemp.temperature < 50 ? (
                          <span className="text-green-600 font-medium">
                            ✅ Optimal: 30-50°C range
                          </span>
                        ) : (
                          <span className="text-yellow-600 font-medium">
                            🌡️ Warm: Above 50°C
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {highestRpm && (
                <div className="p-3 bg-orange-50 text-orange-800 border border-orange-200 rounded-lg shadow-sm">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">⚡</span>
                    <div className="flex-1">
                      <div className="font-semibold text-sm">
                        Highest RPM: {highestRpm.speed}
                      </div>
                      <div className="text-xs text-orange-600">
                        {(() => {
                          const d = safeDate(highestRpm.timestamp);
                          return d ? d.toLocaleString() : "Invalid Date";
                        })()}
                      </div>
                      <div className="text-xs mt-1">
                        {highestRpm.speed > 3000 ? (
                          <span className="text-red-600 font-medium">
                            🚨 Overload: Above 3000 RPM limit
                          </span>
                        ) : highestRpm.speed > 2500 ? (
                          <span className="text-orange-600 font-medium">
                            ⚡ High: 2500-3000 RPM range
                          </span>
                        ) : highestRpm.speed > 1500 ? (
                          <span className="text-green-600 font-medium">
                            ✅ Optimal: 1500-2500 RPM range
                          </span>
                        ) : (
                          <span className="text-blue-600 font-medium">
                            🐌 Low: Below 1500 RPM
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {lowestRpm && (
                <div className="p-3 bg-blue-50 text-blue-800 border border-blue-200 rounded-lg shadow-sm">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">🐌</span>
                    <div className="flex-1">
                      <div className="font-semibold text-sm">
                        Lowest RPM: {lowestRpm.speed}
                      </div>
                      <div className="text-xs text-blue-600">
                        {(() => {
                          const d = safeDate(lowestRpm.timestamp);
                          return d ? d.toLocaleString() : "Invalid Date";
                        })()}
                      </div>
                      <div className="text-xs mt-1">
                        {lowestRpm.speed < 500 ? (
                          <span className="text-red-600 font-medium">
                            🚨 Stall Risk: Below 500 RPM
                          </span>
                        ) : lowestRpm.speed < 1000 ? (
                          <span className="text-orange-600 font-medium">
                            ⚠️ Low: 500-1000 RPM range
                          </span>
                        ) : lowestRpm.speed < 1500 ? (
                          <span className="text-yellow-600 font-medium">
                            🐌 Idle: 1000-1500 RPM range
                          </span>
                        ) : (
                          <span className="text-green-600 font-medium">
                            ✅ Normal: Above 1500 RPM
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Readings Section */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Motor Readings</h2>
            <div className="flex items-center space-x-3">
              <button
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors duration-200 font-medium"
                onClick={exportCsv}
              >
                Export CSV
              </button>
              <button
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors duration-200 font-medium"
                onClick={() =>
                  window.open(
                    `${API_BASE_URL}/api/motor/export?format=json`,
                    "_blank"
                  )
                }
              >
                Export JSON
              </button>
            </div>
          </div>

          {/* Color Legend */}
          <ColorLegend />

          {/* Reading List */}
          <div className="mb-8">
            <ReadingList readings={readings} />
          </div>
        </div>

        {/* Industrial Sensor Dashboard */}
        <div className="mb-8">
          <SensorDashboard reading={readings[0] || null} />
        </div>

        {/* Advanced Analytics Dashboard */}
        <div className="mb-8">
          <AnalyticsDashboard machineId="MOTOR-001" />
        </div>

        {/* Industrial Management Dashboard */}
        <div className="mb-8">
          <IndustrialManagementDashboard facilityId="FACILITY-001" />
        </div>

        {/* Daily Life Applications */}
        <div className="mb-8">
          <DailyLifeApplications reading={readings[0] || null} />
        </div>

        {/* IoT Cloud Integration */}
        <div className="mb-8">
          <IoTCloudIntegration reading={readings[0] || null} />
        </div>

        {/* Mobile Dashboard */}
        <MobileDashboard
          reading={readings[0] || null}
          onRefresh={() => {
            axios.get(`${API_BASE_URL}/api/motor/sample`);
            setFastSpinCount((c) => c + 1);
          }}
        />

        {/* Settings Modal */}
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          maxReadings={maxReadings}
          setMaxReadings={setMaxReadings}
        />
      </div>
    </div>
  );
}

export default App;
