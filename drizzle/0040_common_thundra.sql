CREATE TABLE `galleryCashTransactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`saleId` int NOT NULL,
	`installmentId` int,
	`amount` int NOT NULL,
	`cashbox` enum('gallery','main') NOT NULL,
	`transactionDate` timestamp NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `galleryCashTransactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `galleryInstallments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`saleId` int NOT NULL,
	`dueDate` timestamp NOT NULL,
	`amount` int NOT NULL,
	`paidAmount` int NOT NULL DEFAULT 0,
	`status` enum('pending','partial','paid') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `galleryInstallments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `galleryProducts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`category` varchar(120) NOT NULL DEFAULT 'عام',
	`unit` varchar(40) NOT NULL DEFAULT 'قطعة',
	`sellingPrice` int NOT NULL DEFAULT 0,
	`purchasePrice` int NOT NULL DEFAULT 0,
	`stockQuantity` int NOT NULL DEFAULT 0,
	`reorderLevel` int NOT NULL DEFAULT 2,
	`isActive` boolean NOT NULL DEFAULT true,
	`notes` text,
	`clientOperationId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `galleryProducts_id` PRIMARY KEY(`id`),
	CONSTRAINT `gallery_products_owner_operation_unique` UNIQUE(`ownerId`,`clientOperationId`)
);
--> statement-breakpoint
CREATE TABLE `gallerySaleItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`saleId` int NOT NULL,
	`productId` int NOT NULL,
	`productNameSnapshot` varchar(160) NOT NULL,
	`quantity` int NOT NULL,
	`unitPrice` int NOT NULL,
	`lineTotal` int NOT NULL,
	CONSTRAINT `gallerySaleItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `gallerySales` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`invoiceNumber` varchar(64) NOT NULL,
	`customerName` varchar(160),
	`customerPhone` varchar(32),
	`paymentMethod` enum('cash','credit') NOT NULL,
	`totalAmount` int NOT NULL,
	`paidAmount` int NOT NULL DEFAULT 0,
	`remainingAmount` int NOT NULL DEFAULT 0,
	`saleDate` timestamp NOT NULL,
	`cashMode` enum('gallery','main') NOT NULL DEFAULT 'gallery',
	`notes` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `gallerySales_id` PRIMARY KEY(`id`),
	CONSTRAINT `gallery_sales_owner_invoice_unique` UNIQUE(`ownerId`,`invoiceNumber`)
);
--> statement-breakpoint
CREATE TABLE `gallerySettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerId` int NOT NULL,
	`mergeWithMainCash` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gallerySettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `gallery_settings_owner_unique` UNIQUE(`ownerId`)
);
--> statement-breakpoint
ALTER TABLE `galleryCashTransactions` ADD CONSTRAINT `galleryCashTransactions_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `galleryCashTransactions` ADD CONSTRAINT `galleryCashTransactions_saleId_gallerySales_id_fk` FOREIGN KEY (`saleId`) REFERENCES `gallerySales`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `galleryCashTransactions` ADD CONSTRAINT `galleryCashTransactions_installmentId_galleryInstallments_id_fk` FOREIGN KEY (`installmentId`) REFERENCES `galleryInstallments`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `galleryInstallments` ADD CONSTRAINT `galleryInstallments_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `galleryInstallments` ADD CONSTRAINT `galleryInstallments_saleId_gallerySales_id_fk` FOREIGN KEY (`saleId`) REFERENCES `gallerySales`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `galleryProducts` ADD CONSTRAINT `galleryProducts_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gallerySaleItems` ADD CONSTRAINT `gallerySaleItems_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gallerySaleItems` ADD CONSTRAINT `gallerySaleItems_saleId_gallerySales_id_fk` FOREIGN KEY (`saleId`) REFERENCES `gallerySales`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gallerySaleItems` ADD CONSTRAINT `gallerySaleItems_productId_galleryProducts_id_fk` FOREIGN KEY (`productId`) REFERENCES `galleryProducts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gallerySales` ADD CONSTRAINT `gallerySales_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gallerySales` ADD CONSTRAINT `gallerySales_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `gallerySettings` ADD CONSTRAINT `gallerySettings_ownerId_users_id_fk` FOREIGN KEY (`ownerId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `gallery_cash_owner_date_idx` ON `galleryCashTransactions` (`ownerId`,`transactionDate`);--> statement-breakpoint
CREATE INDEX `gallery_cash_sale_idx` ON `galleryCashTransactions` (`ownerId`,`saleId`);--> statement-breakpoint
CREATE INDEX `gallery_installments_owner_due_idx` ON `galleryInstallments` (`ownerId`,`dueDate`,`status`);--> statement-breakpoint
CREATE INDEX `gallery_products_owner_idx` ON `galleryProducts` (`ownerId`);--> statement-breakpoint
CREATE INDEX `gallery_sale_items_sale_idx` ON `gallerySaleItems` (`ownerId`,`saleId`);--> statement-breakpoint
CREATE INDEX `gallery_sale_items_product_idx` ON `gallerySaleItems` (`ownerId`,`productId`);--> statement-breakpoint
CREATE INDEX `gallery_sales_owner_date_idx` ON `gallerySales` (`ownerId`,`saleDate`);