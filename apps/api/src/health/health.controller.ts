import { Controller, Get } from "@nestjs/common";

interface LiveHealthDto {
  status: "healthy";
  service: "api";
  timestamp: string;
}

@Controller("health")
export class HealthController {
  @Get("live")
  live(): LiveHealthDto {
    return {
      status: "healthy",
      service: "api",
      timestamp: new Date().toISOString(),
    };
  }
}
