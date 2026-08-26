ALTER TABLE `inventoryMovements` ADD `customerId` int;--> statement-breakpoint
ALTER TABLE `inventoryMovements` ADD CONSTRAINT `inventoryMovements_customerId_customers_id_fk` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `inventory_movements_customer_idx` ON `inventoryMovements` (`ownerId`,`customerId`);