// kill-port.js
const { execSync } = require("child_process");

const PORT = process.env.PORT || 3000;

try {
  const result = execSync(`lsof -t -i:${PORT}`).toString().trim();
  if (result) {
    console.log(`🔪 Matando proceso en puerto ${PORT}: PID ${result}`);
    execSync(`kill -9 ${result}`);
  }
} catch (e) {
  console.log(`No hay procesos en el puerto ${PORT}`);
}