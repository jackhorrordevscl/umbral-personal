-- Issue #73 (punto 7): notificationsConsent nunca se expuso en ningun DTO
-- de creacion/edicion de Patient ni se renderizo en el frontend -- ninguna
-- cuenta pudo cambiarlo de su default `false` a traves de la app. No hay
-- feature de notificaciones implementada que lo use. Se elimina en vez de
-- dejarlo a medio cablear; si se implementa notificaciones en el futuro, se
-- vuelve a agregar junto con su UI real.
ALTER TABLE "Patient" DROP COLUMN "notificationsConsent";
