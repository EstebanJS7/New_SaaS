import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { ContextModule } from "../context/context.module.js";
import { RbacModule } from "../rbac/rbac.module.js";
import { CustomerAddressesController } from "./customer-addresses.controller.js";
import { CustomerContactsController } from "./customer-contacts.controller.js";
import { CustomersController } from "./customers.controller.js";
import { CustomersService } from "./customers.service.js";

@Module({
  imports: [ContextModule, RbacModule, AuditModule],
  controllers: [CustomerAddressesController, CustomerContactsController, CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
