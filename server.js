const express = require('express');
const mongoose = require('mongoose'); 
const cors = require('cors');
const ical = require('node-ical');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const MONGO_URI = process.env.MONGO_URI;

// Opciones de conexión con Timeout estricto para evitar congelamientos
mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000, // Máximo 5 segs buscando servidor
    socketTimeoutMS: 10000,          // Máximo 10 segs por consulta
})
.then(() => console.log('🟢 CONECTADO A MONGO ATLAS'))
.catch((err) => console.error('🔴 ERROR DE CONEXIÓN MONGO:', err.message));

// Definición de modelos dinámicos con esquemas flexibles para cada módulo (Opción 2)
const createModuleModel = (modelName, collectionName) => {
    const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
    return mongoose.models[modelName] || mongoose.model(modelName, schema, collectionName);
};

const Propiedad = createModuleModel('Propiedad', 'propiedades');
const Prospecto = createModuleModel('Prospecto', 'prospectos');
const Empleada = createModuleModel('Empleada', 'empleadas');
const Administrador = createModuleModel('Administrador', 'administradores');
const Tarea = createModuleModel('Tarea', 'tareas');
const ReporteInspeccion = createModuleModel('ReporteInspeccion', 'reportes-inspeccion');
const Lavanderia = createModuleModel('Lavanderia', 'lavanderia');
const Faltante = createModuleModel('Faltante', 'faltantes');
const Programacion = createModuleModel('Programacion', 'programacion');
const Ruta = createModuleModel('Ruta', 'ruta');
const SolicitudCompartir = createModuleModel('SolicitudCompartir', 'solicitudes-compartir');
const Fianza = createModuleModel('Fianza', 'fianzas');

// Mapeo de rutas/claves a sus respectivos modelos de Mongoose
const modelsMap = {
    'propiedades': Propiedad,
    'prospectos': Prospecto,
    'empleadas': Empleada,
    'administradores': Administrador,
    'tareas': Tarea,
    'reportes-inspeccion': ReporteInspeccion,
    'lavanderia': Lavanderia,
    'faltantes': Faltante,
    'programacion': Programacion,
    'ruta': Ruta,
    'solicitudes-compartir': SolicitudCompartir,
    'fianzas': Fianza
};

// --- FUNCIÓN DE SINCRONIZACIÓN AUTOMÁTICA iCal (ESTILO TURNO) ---
async function sincronizarCalendariosIcal() {
    console.log("🔄 Iniciando sincronización automática de calendarios iCal...");
    try {
        if (mongoose.connection.readyState !== 1) {
            console.log("⚠️ MongoDB no está conectado, omitiendo sincronización iCal por ahora.");
            return;
        }

        // Buscar propiedades que tengan un enlace icalUrl registrado
        const propiedadesConIcal = await Propiedad.find({ icalUrl: { $exists: true, $ne: "" } });

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        // Definir mañana para buscar las salidas de huéspedes
        const maniana = new Date(hoy);
        maniana.setDate(maniana.getDate() + 1);

        for (let prop of propiedadesConIcal) {
            try {
                if (!prop.icalUrl) continue;
                
                // Descargar eventos del iCal de Airbnb/Booking de forma asíncrona
                const webEvents = await ical.async.fromURL(prop.icalUrl);
                
                for (let k in webEvents) {
                    if (webEvents.hasOwnProperty(k)) {
                        const ev = webEvents[k];
                        if (ev.type === 'VEVENT') {
                            const fechaSalida = new Date(ev.end);
                            fechaSalida.setHours(0, 0, 0, 0);

                            // Si el huésped sale mañana, se programa limpieza automáticamente
                            if (fechaSalida.getTime() === maniana.getTime()) {
                                
                                // Verificar si ya existe una tarea para esta propiedad en esta fecha
                                const tareaExistente = await Tarea.findOne({
                                    propiedadId: prop._id.toString(),
                                    fecha: {
                                        $gte: maniana,
                                        $lt: new Date(maniana.getTime() + 24 * 60 * 60 * 1000)
                                    }
                                });

                                if (!tareaExistente) {
                                    const nuevaTarea = new Tarea({
                                        adminId: prop.adminId,
                                        propiedadId: prop._id.toString(),
                                        propiedadNombre: prop.nombre || 'Propiedad',
                                        tipo: 'limpieza_salida',
                                        estado: 'pendiente',
                                        descripcion: `Limpieza automática por check-out (${ev.summary || 'Reserva Externa'})`,
                                        fecha: maniana,
                                        empleadaId: null
                                    });

                                    await nuevaTarea.save();
                                    console.log(`✨ Tarea de limpieza creada automáticamente para: ${prop.nombre}`);
                                }
                            }
                        }
                    }
                }
            } catch (errCal) {
                console.error(`⚠️ Error procesando iCal para la propiedad ${prop.nombre || prop._id}:`, errCal.message);
            }
        }
        console.log("✅ Sincronización iCal finalizada con éxito.");
    } catch (error) {
        console.error("🔴 Error general en sincronización iCal:", error.message);
    }
}

// Ejecutar sincronización iCal automáticamente cada 3 horas en segundo plano
setInterval(sincronizarCalendariosIcal, 3 * 60 * 60 * 1000);

// Endpoint manual para forzar la sincronización iCal desde el panel
app.post('/api/sincronizar-ical', async (req, res) => {
    try {
        await sincronizarCalendariosIcal();
        return res.json({ success: true, message: 'Sincronización iCal ejecutada correctamente' });
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

// Endpoint de prueba de conexión directa a la BD
app.get('/api/test-db', async (req, res) => {
    try {
        const estadoMongo = mongoose.connection.readyState;
        if (estadoMongo !== 1) {
            return res.status(500).json({ status: 'error', message: 'Mongo no está listo', state: estadoMongo });
        }
        const total = await Propiedad.countDocuments();
        return res.json({ status: 'ok', totalPropiedades: total });
    } catch (error) {
        return res.status(500).json({ status: 'error', detail: error.message });
    }
});

// Ruta GET ultra-segura para actualizar por ID evitando restricciones de Nginx
app.get('/api/update-propiedad-safe', async (req, res) => {
    try {
        const { id, status, code } = req.query;
        if (!id) {
            return res.status(400).json({ success: false, message: 'ID no proporcionado' });
        }

        const itemActualizado = await Propiedad.findByIdAndUpdate(
            id,
            { $set: { status, code } },
            { new: true, runValidators: true }
        );

        if (!itemActualizado) {
            return res.status(404).json({ success: false, message: 'Propiedad no encontrada' });
        }

        return res.json({ success: true, data: itemActualizado });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// Ruta GET de respaldo para saltar restricciones de métodos POST/PATCH bloqueados por el proxy web
app.get('/api/actualizar-propiedad-get', async (req, res) => {
    try {
        const { id, status, code } = req.query;
        if (!id) {
            return res.status(400).json({ success: false, message: 'ID no proporcionado' });
        }

        const itemActualizado = await Propiedad.findByIdAndUpdate(
            id,
            { $set: { status, code } },
            { new: true, runValidators: true }
        );

        if (!itemActualizado) {
            return res.status(404).json({ success: false, message: 'Propiedad no encontrada' });
        }

        return res.json({ success: true, data: itemActualizado });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// --- ENDPOINTS ESPECÍFICOS PARA SOLICITUDES DE SINCRONIZACIÓN ENTRE ADMINISTRADORES ---

app.post('/api/solicitudes-compartir/:id/responder', async (req, res) => {
    try {
        const { accion, adminId } = req.body;
        const solicitudId = req.params.id;
        const solicitud = await SolicitudCompartir.findById(solicitudId);

        if (!solicitud) {
            return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
        }

        if (accion === 'aceptar') {
            const items = solicitud.items || [];
            const nuevosItems = items.map(item => {
                const newItemObj = { ...item };
                delete newItemObj._id; 
                newItemObj.adminId = adminId;
                newItemObj.copiadoDe = solicitud.deAdminId;
                return newItemObj;
            });

            if (solicitud.tipo === 'programacion' && nuevosItems.length > 0) {
                await Programacion.insertMany(nuevosItems);
            } else if (solicitud.tipo === 'ruta' && nuevosItems.length > 0) {
                await Ruta.insertMany(nuevosItems);
            }

            await SolicitudCompartir.findByIdAndUpdate(solicitudId, { $set: { estado: 'aceptado' } });
        } else {
            await SolicitudCompartir.findByIdAndUpdate(solicitudId, { $set: { estado: 'rechazado' } });
        }

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// --- FIN ENDPOINTS ESPECÍFICOS ---

// GET Adaptativo por Colección Especifica
app.get('/api/:key', async (req, res) => {
    const { key } = req.params;
    console.log(`[API REQUEST] Solicitando colección: ${key}`);

    try {
        if (mongoose.connection.readyState !== 1) {
            console.error(`[API ERROR] Mongo no conectado al pedir: ${key}`);
            return res.status(503).json({ error: true, message: "Base de datos no disponible temporalmente" });
        }

        const Model = modelsMap[key];
        if (!Model) {
            console.log(`[API INFO] Clave '${key}' no mapeada a ninguna colección.`);
            return res.status(404).json({ error: true, message: `Ruta /api/${key} inexistente` });
        }

        // Filtros dinámicos basados en query parameters (Excluyendo administradores del filtro por adminId)
        const queryFilter = {};
        if (key === 'solicitudes-compartir') {
            if (req.query.paraAdminId) queryFilter.paraAdminId = req.query.paraAdminId;
            if (req.query.estado) queryFilter.estado = req.query.estado;
            if (req.query.deAdminId) queryFilter.deAdminId = req.query.deAdminId;
        } else if (req.query.adminId && key !== 'administradores') {
            queryFilter.adminId = req.query.adminId;
        }

        const items = await Model.find(queryFilter).exec();

        if (!items || items.length === 0) {
            console.log(`[API INFO] Colección '${key}' vacía o sin registros para este filtro, retornando []`);
            return res.json([]);
        }

        console.log(`[API SUCCESS] Colección '${key}' enviada con éxito.`);
        return res.json(items);
    } catch (error) {
        console.error(`[API FATAL] Error procesando '${key}':`, error.message);
        return res.status(500).json({ error: true, message: error.message });
    }
});

// POST Adaptativo para Colecciones (Exige adminId solo en colecciones operativas, exceptuando administradores)
app.post('/api/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = req.body;
        const queryAdminId = req.query.adminId || req.headers['x-admin-id'];

        const Model = modelsMap[key];
        if (!Model) {
            return res.status(404).json({ error: true, message: `Ruta /api/${key} inexistente` });
        }

        if (Array.isArray(data)) {
            if (key !== 'solicitudes-compartir' && key !== 'administradores') {
                const adminId = queryAdminId || (data.length > 0 ? data[0].adminId : null);
                if (!adminId) {
                    return res.status(400).json({ error: true, message: 'Se requiere un adminId válido para procesar esta operación por lotes.' });
                }
                await Model.deleteMany({ adminId });
            }
            if (data.length > 0) {
                const nuevosDatos = data.map(item => {
                    const resolvedAdminId = item.adminId || queryAdminId;
                    if (!resolvedAdminId && key !== 'administradores') {
                        throw new Error('Elemento sin adminId válido asignado.');
                    }
                    return {
                        ...item,
                        ...(resolvedAdminId ? { adminId: resolvedAdminId } : {})
                    };
                });
                await Model.insertMany(nuevosDatos);
            }
            return res.json({ success: true, count: data.length });
        } else {
            // Inserción individual
            const resolvedAdminId = data.adminId || queryAdminId;
            if (!resolvedAdminId && key !== 'administradores') {
                return res.status(400).json({ error: true, message: 'Falta el adminId obligatorio para guardar este registro.' });
            }

            const itemData = { 
                ...data,
                ...(resolvedAdminId ? { adminId: resolvedAdminId } : {})
            };
            
            const nuevoItem = new Model(itemData);
            await nuevoItem.save();
            return res.json(nuevoItem);
        }
    } catch (error) {
        return res.status(500).json({ error: true, message: error.message });
    }
});

// PUT Adaptativo por Colección y ID
app.put('/api/:key/:id', async (req, res) => {
    try {
        const { key, id } = req.params;
        const data = req.body;

        const Model = modelsMap[key];
        if (!Model) {
            return res.status(404).json({ error: true, message: `Ruta /api/${key} inexistente` });
        }

        const itemActualizado = await Model.findByIdAndUpdate(
            id,
            { $set: data },
            { new: true, runValidators: true }
        );

        if (!itemActualizado) {
            return res.status(404).json({ error: true, message: 'Documento no encontrado para actualizar' });
        }

        return res.json(itemActualizado);
    } catch (error) {
        return res.status(500).json({ error: true, message: error.message });
    }
});

// PATCH Adaptativo por Colección y ID
app.patch('/api/:key/:id', async (req, res) => {
    try {
        const { key, id } = req.params;
        const data = req.body;

        const Model = modelsMap[key];
        if (!Model) {
            return res.status(404).json({ error: true, message: `Ruta /api/${key} inexistente` });
        }

        const itemActualizado = await Model.findByIdAndUpdate(
            id,
            { $set: data },
            { new: true, runValidators: true }
        );

        if (!itemActualizado) {
            return res.status(404).json({ error: true, message: 'Documento no encontrado para actualizar' });
        }

        return res.json(itemActualizado);
    } catch (error) {
        return res.status(500).json({ error: true, message: error.message });
    }
});

// DELETE Específico por ID
app.delete('/api/:key/:id', async (req, res) => {
    try {
        const { key, id } = req.params;
        const Model = modelsMap[key];
        if (!Model) {
            return res.status(404).json({ error: true, message: `Ruta /api/${key} inexistente` });
        }

        await Model.findByIdAndDelete(id);
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: true, message: error.message });
    }
});

// Endpoint GET para sincronizar iCal manualmente desde el botón del frontend
app.get('/api/sincronizar-ical', async (req, res) => {
    console.log("📥 ¡Petición GET recibida para sincronizar iCal manualmente!");
    try {
        await sincronizarCalendariosIcal();
        return res.json({ success: true, message: 'Sincronización iCal ejecutada correctamente' });
    } catch (e) {
        console.error("❌ Error en endpoint sincronizar-ical:", e.message);
        return res.status(500).json({ success: false, message: e.message });
    }
});

// Manejo final de rutas no encontradas bajo /api
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: true, message: `Ruta ${req.originalUrl} inexistente` });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
