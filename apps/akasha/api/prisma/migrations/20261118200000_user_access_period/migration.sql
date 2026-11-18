-- Masa akses dari SSO workingspace.id (baca saja setelah habis, data dihapus setelah access_delete_at)
ALTER TABLE "users" ADD COLUMN     "access_delete_at" TIMESTAMPTZ(3),
ADD COLUMN     "access_expires_at" TIMESTAMPTZ(3);
