-- CreateTable
CREATE TABLE "kernel"."Holiday" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "Holiday_year_idx" ON "kernel"."Holiday"("year");
