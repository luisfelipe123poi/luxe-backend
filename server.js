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
.then(() => console.log('🟢 CONECTADO A MONGO ATLAS (SISTEMA MULTI-EMPRESA AISLADO)'))
.catch((err) => console.error('🔴 ERROR DE CONEXIÓN MONGO:', err.message));

// Definición de modelos dinámicos con esquemas flexibles para cada módulo
const createModuleModel = (modelName, collectionName) => {
    const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
    return mongoose.models[modelName] || mongoose.model(modelName, schema, collectionName);
};

// Modelo principal de Empresas para la arquitectura SaaS Multi-tenant
const Empresa = createModuleModel('Empresa', 'empresas');

const Propiedad = createModuleModel('Propiedad', 'propiedades');
const Prospecto = createModuleModel('Prospecto', 'prospectos');
const Empleada = createModuleModel('Empleada', 'empleadas');
const Administrador = createModuleModel('Administrador', 'administradores');
const Tarea = createModuleModel('Tarea', 'tareas');
const TareaIcal = createModuleModel('TareaIcal', 'tareas-ical'); 
const ReporteInspeccion = createModuleModel('ReporteInspeccion', 'reportes-inspeccion');
const Lavanderia = createModuleModel('Lavanderia', 'lavanderia');
const Faltante = createModuleModel('Faltante', 'faltantes');
const Programacion = createModuleModel('Programacion', 'programacion');
const Ruta = createModuleModel('Ruta', 'ruta');
const SolicitudCompartir = createModuleModel('SolicitudCompartir', 'solicitudes-compartir');
const Fianza = createModuleModel('Fianza', 'fianzas');

// Mapeo de rutas/claves a sus respectivos modelos de Mongoose
const modelsMap = {
    'empresas': Empresa,
    'propiedades': Propiedad,
    'prospectos': Prospecto,
    'empleadas': Empleada,
    'administradores': Administrador,
    'tareas': Tarea,
    'tareas-ical': TareaIcal, 
    'reportes-inspeccion': ReporteInspeccion,
    'lavanderia': Lavanderia,
    'faltantes': Faltante,
    'programacion': Programacion,
    'ruta': Ruta,
    'solicitudes-compartir': SolicitudCompartir,
    'fianzas': Fianza
};

// --- FUNCIÓN DE ALERTA TELEGRAM DINÁMICA POR EMPRESA ---
async function enviarAlertaTelegramPorEmpresa(empresaId, mensajeTelegram) {
    try {
        if (!empresaId) {
            console.log("⚠️ No se proporcionó empresaId para enviar la alerta de Telegram, omitiendo...");
            return;
        }

        const empresa = await Empresa.findById(empresaId);
        
        if (!empresa || !empresa.telegramToken || !empresa.telegramChatId) {
            console.log(`ℹ️ La empresa con ID ${empresaId} no tiene configurado un bot de Telegram propio. Alerta omitida.`);
            return;
        }

        const token = empresa.telegramToken;
        const chatId = empresa.telegramChatId;
        const urlTelegram = `https://api.telegram.org/bot${token}/sendMessage`;

        const respuesta = await fetch(urlTelegram, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: mensajeTelegram,
                parse_mode: 'Markdown'
            })
        });

        const resultado = await respuesta.json();
        if (!resultado.ok) {
            console.error(`❌ Error enviando Telegram para empresa ${empresaId}:`, resultado.description);
        } else {
            console.log(`🚀 Alerta de Telegram enviada exitosamente al bot de la empresa ID: ${empresaId}`);
        }
    } catch (error) {
        console.error("🔴 Error crítico al enviar alerta de Telegram por empresa:", error.message);
    }
}

// Función global de Telegram de respaldo (para recordatorios generales o del sistema)
async function enviarAlertaTelegram(mensaje) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!token || !chatId) {
        console.log("⚠️ Telegram Bot Token o Chat ID globales no configurados.");
        return;
    }

    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: mensaje,
                parse_mode: 'Markdown'
            })
        });
        const data = await response.json();
        if (!data.ok) {
            console.error("❌ Error enviando mensaje global a Telegram:", data.description);
        }
    } catch (error) {
        console.error("❌ Error de red al enviar alerta global a Telegram:", error.message);
    }
}

// --- FUNCIÓN DE SINCRONIZACIÓN AUTOMÁTICA iCal AISLADA ---
async function sincronizarCalendariosIcal(empresaIdFiltro = null, adminIdFiltro = null) {
    console.log("🔄 Iniciando sincronización automática de calendarios iCal (Multi-empresa y Bot personalizado)...");
    try {
        if (mongoose.connection.readyState !== 1) {
            console.log("⚠️ MongoDB no está conectado, omitiendo sincronización iCal por ahora.");
            return;
        }

        // AQUÍ ESTÁ LA LÍNEA CORREGIDA SIN BARRAS DE ESCAPE
        const filtroQuery = {
            $or: [
                { icalUrl: { \(exists: true,\)ne: "" } },
                { urlIcal: { \(exists: true,\)ne: "" } }
            ]
        };

        if (empresaIdFiltro) filtroQuery.empresaId = empresaIdFiltro;
        if (adminIdFiltro) filtroQuery.adminId = adminIdFiltro;

        const propiedadesConIcal = await Propiedad.find(filtroQuery);
        console.log(`🏠 Propiedades con iCal encontradas: ${propiedadesConIcal.length}`);

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);

        for (let prop of propiedadesConIcal) {
            try {
                const enlaceIcal = prop.icalUrl || prop.urlIcal;
                if (!enlaceIcal) continue;
                
                console.log(`📥 Descargando iCal para: \({prop.nombre || prop._id} ->\){enlaceIcal}`);
                
                const webEvents = await ical.async.fromURL(enlaceIcal);
                let eventosProcesados = 0;
                
                for (let k in webEvents) {
                    if (webEvents.hasOwnProperty(k)) {
                        const ev = webEvents[k];
                        if (ev.type === 'VEVENT') {
                            eventosProcesados++;
                            const fechaSalida = new Date(ev.end);

                            if (fechaSalida >= hoy) {
                                const nombrePropiedad = prop.nombre || 'Propiedad';
                                
                                const empresaProp = prop.empresaId || empresaIdFiltro || null;
                                const adminProp = prop.adminId || adminIdFiltro || 'global';
                                
                                const tareaExistente = await TareaIcal.findOne({
                                    propiedadId: prop._id.toString(),
                                    descripcion: new RegExp(ev.summary || 'Reserva Externa', 'i'),
                                    ...(empresaProp ? { empresaId: empresaProp } : {})
                                });

                                if (!tareaExistente) {
                                    const nuevaTareaIcal = new TareaIcal({
                                        empresaId: empresaProp,   
                                        adminId: adminProp,       
                                        propiedadId: prop._id.toString(),
                                        propiedadNombre: nombrePropiedad,
                                        tipo: 'limpieza_salida_ical',
                                        estado: 'pendiente',
                                        descripcion: `🧹 Limpieza iCal de salida para [\({nombrePropiedad}] - Reserva: (\){ev.summary || 'Reserva Externa'})`,
                                        fecha: fechaSalida,
                                        empleadaId: null,
                                        origen: 'iCal Automático'
                                    });

                                    await nuevaTareaIcal.save();
                                    console.log(`✨ Tarea iCal creada con éxito para: \({nombrePropiedad} (Empresa:\){empresaProp})`);

                                    const fechaFormateada = fechaSalida.toLocaleDateString('es-CO', { timeZone: 'UTC' });
                                    const mensajeTelegram = `🧹 *¡Nueva Reserva Detectada!* \n\n` +
                                                            `🏠 Propiedad: *${nombrePropiedad}*\n` +
                                                            `📅 Fecha de Salida: *${fechaFormateada}*\n` +
                                                            `🏷️ Detalle: _(${ev.summary || 'Reserva Externa'})_\n\n` +
                                                            `_Se ha programado la limpieza automáticamente en el sistema._`;
                                    
                                    if (empresaProp) {
                                        await enviarAlertaTelegramPorEmpresa(empresaProp, mensajeTelegram);
                                    } else {
                                        console.log("⚠️ Tarea creada sin empresaId asociada, no se puede enviar al bot de Telegram.");
                                    }

                                } else {
                                    console.log(`ℹ️ La tarea para esta reserva ya existía en la base de datos.`);
                                }
                            }
                        }
                    }
                }
                console.log(`✅ Propiedad \({prop.nombre}:\){eventosProcesados} eventos totales evaluados.`);
            } catch (errCal) {
                console.error(`⚠️ Error procesando iCal para la propiedad ${prop.nombre || prop._id}:`, errCal.message);
            }
        }
        console.log("✅ Sincronización iCal finalizada con éxito.");
    } catch (error) {
        console.error("🔴 Error general en sincronización iCal:", error.message);
    }
}

// ==========================================
// EJECUCIÓN AUTOMÁTICA EN SEGUNDO PLANO
// ==========================================

// 1. Ejecutar la sincronización automáticamente cada 1 minuto
const INTERVALO_TIEMPO = 60 * 1000; 

setInterval(() => {
    console.log("⏱️ [AUTOMÁTICO] Ejecutando tarea programada de iCal...");
    sincronizarCalendariosIcal();
}, INTERVALO_TIEMPO);

// 2. Ejecutar una vez al arrancar el servidor
setTimeout(() => {
    console.log("🚀 [INICIO] Ejecutando primera sincronización iCal al arrancar el servidor...");
    sincronizarCalendariosIcal();
}, 10000);

// Almacenar las referencias de los temporizadores activos
let timersActivos = [];

function limpiarTimersAnteriores() {
    timersActivos.forEach(timer => clearTimeout(timer));
    timersActivos = [];
}

async function programarAlertasDelDia() {
    try {
        if (mongoose.connection.readyState !== 1) return;

        console.log("⏰ Calculando y programando las alertas exactas del día...");
        limpiarTimersAnteriores();

        const ahora = new Date();

        const programaciones = await Programacion.find({ estado: { $ne: 'completado' } });

        programaciones.forEach(prog => {
            if (prog.hora) { 
                const [horas, minutos] = prog.hora.split(':');
                const fechaAlerta = new Date();
                fechaAlerta.setHours(parseInt(horas, 10), parseInt(minutos, 10), 0, 0);

                const milisegundosHastaAlerta = fechaAlerta.getTime() - ahora.getTime();

                if (milisegundosHastaAlerta > 0) {
                    const timerId = setTimeout(async () => {
                        const mensaje = `⏰ *¡Recordatorio de Programación!* \n\n` +
                                        `📋 Actividad: *${prog.descripcion || prog.titulo || 'Sin descripción'}*\n` +
                                        `🕒 Hora programada: *${prog.hora}*\n\n` +
                                        `_Es hora de poner en marcha esta tarea._`;

                        if (prog.empresaId) {
                            await enviarAlertaTelegramPorEmpresa(prog.empresaId, mensaje);
                        } else {
                            await enviarAlertaTelegram(mensaje);
                        }
                        await Programacion.findByIdAndUpdate(prog._id, { $set: { alertaEnviada: true } });
                    }, milisegundosHastaAlerta);

                    timersActivos.push(timerId);
                }
            }
        });

        const rutas = await Ruta.find({ estado: { $ne: 'completado' } });

        rutas.forEach(ruta => {
            const horaRuta = ruta.horaSalida || ruta.hora;
            if (horaRuta) {
                const [horas, minutos] = horaRuta.split(':');
                const fechaAlertaRuta = new Date();
                fechaAlertaRuta.setHours(parseInt(horas, 10), parseInt(minutos, 10), 0, 0);

                const msHastaRuta = fechaAlertaRuta.getTime() - ahora.getTime();

                if (msHastaRuta > 0) {
                    const timerId = setTimeout(async () => {
                        const mensajeRuta = `🚗 *¡Alerta de Ruta Programada!* \n\n` +
                                            `📍 Destino: *${ruta.destino || ruta.nombre || 'Ruta activa'}*\n` +
                                            `🕒 Hora de salida: *${horaRuta}*\n\n` +
                                            `_Prepárate para la salida de la ruta._`;

                        if (ruta.empresaId) {
                            await enviarAlertaTelegramPorEmpresa(ruta.empresaId, mensajeRuta);
                        } else {
                            await enviarAlertaTelegram(mensajeRuta);
                        }
                        await Ruta.findByIdAndUpdate(ruta._id, { $set: { alertaEnviada: true } });
                    }, msHastaRuta);

                    timersActivos.push(timerId);
                }
            }
        });

        console.log(`✅ Se han programado ${timersActivos.length} alertas exactas en segundo plano para hoy.`);

    } catch (error) {
        console.error("❌ Error programando las alertas del día:", error.message);
    }
}

programarAlertasDelDia();
setInterval(programarAlertasDelDia, 12 * 60 * 60 * 1000);

// Endpoint universal para forzar la sincronización iCal con soporte multi-empresa
app.all('/api/sincronizar-ical', async (req, res) => {
    console.log(`📥 ¡Petición ${req.method} recibida para sincronizar iCal manualmente!`);
    try {
        const empresaId = req.query.empresaId || req.body.empresaId || req.headers['x-empresa-id'] || req.headers['x-company-id'];
        const adminId = req.query.adminId || req.body.adminId || req.headers['x-admin-id'];

        await sincronizarCalendariosIcal(empresaId, adminId);
        return res.json({ success: true, message: 'Sincronización iCal ejecutada correctamente' });
    } catch (e) {
        console.error("❌ Error en endpoint sincronizar-ical:", e.message);
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

// Rutas de actualización segura por GET
app.get('/api/update-propiedad-safe', async (req, res) => {
    try {
        const { id, status, code, icalUrl, empresaId } = req.query;
        if (!id) {
            return res.status(400).json({ success: false, message: 'ID no proporcionado' });
        }

        const updateData = { status, code };
        if (icalUrl !== undefined) updateData.icalUrl = icalUrl;
        if (empresaId) updateData.empresaId = empresaId;

        const itemActualizado = await Propiedad.findByIdAndUpdate(
            id,
            { $set: updateData },
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

app.get('/api/actualizar-propiedad-get', async (req, res) => {
    try {
        const { id, status, code, icalUrl, empresaId } = req.query;
        if (!id) {
            return res.status(400).json({ success: false, message: 'ID no proporcionado' });
        }

        const updateData = { status, code };
        if (icalUrl !== undefined) updateData.icalUrl = icalUrl;
        if (empresaId) updateData.empresaId = empresaId;

        const itemActualizado = await Propiedad.findByIdAndUpdate(
            id,
            { $set: updateData },
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

// --- ENDPOINTS ESPECÍFICOS PARA SOLICITUDES DE SINCRONIZACIÓN ---
app.post('/api/solicitudes-compartir/:id/responder', async (req, res) => {
    try {
        const { accion, adminId, empresaId } = req.body;
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
                if (empresaId) newItemObj.empresaId = empresaId;
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

// --- ENDPOINTS CRUD ADAPTATIVOS CON AISLAMIENTO MULTI-EMPRESA ESTRICTO ---

// GET Adaptativo por Colección con filtrado estricto por empresaId y adminId
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

        const queryFilter = {};

        const empresaId = req.query.empresaId || req.headers['x-empresa-id'] || req.headers['x-company-id'];
        const adminId = req.query.adminId || req.headers['x-admin-id'];

        if (empresaId && key !== 'empresas' && key !== 'administradores') {
            queryFilter.empresaId = empresaId;
        } else if (!empresaId && key !== 'empresas' && key !== 'administradores') {
            console.warn(`[API SECURITY] Petición a /api/${key} sin empresaId. Retornando vacío.`);
            return res.json([]);
        }

        if (key === 'solicitudes-compartir') {
            if (req.query.paraAdminId) queryFilter.paraAdminId = req.query.paraAdminId;
            if (req.query.estado) queryFilter.estado = req.query.estado;
            if (req.query.deAdminId) queryFilter.deAdminId = req.query.deAdminId;
        } else if (adminId && key !== 'empresas' && key !== 'administradores') {
            // Opcional para filtrar por admin si corresponde
        }

        const items = await Model.find(queryFilter).exec();

        if (!items || items.length === 0) {
            return res.json([]);
        }

        console.log(`[API SUCCESS] Colección '\({key}' enviada con éxito (\){items.length} registros).`);
        return res.json(items);
    } catch (error) {
        console.error(`[API FATAL] Error procesando '${key}':`, error.message);
        return res.status(500).json({ error: true, message: error.message });
    }
});

// GET Adaptativo por Colección y ID
app.get('/api/:key/:id', async (req, res) => {
    try {
        const { key, id } = req.params;
        const Model = modelsMap[key];
        if (!Model) {
            return res.status(404).json({ error: true, message: `Ruta /api/${key} inexistente` });
        }

        const item = await Model.findById(id);
        if (!item) {
            return res.status(404).json({ error: true, message: 'Documento no encontrado' });
        }

        return res.json(item);
    } catch (error) {
        return res.status(500).json({ error: true, message: error.message });
    }
});

// POST Adaptativo para Colecciones
app.post('/api/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = req.body;
        
        const queryEmpresaId = req.query.empresaId || req.body.empresaId || req.headers['x-empresa-id'] || req.headers['x-company-id'];
        const queryAdminId = req.query.adminId || req.body.adminId || req.headers['x-admin-id'];

        const Model = modelsMap[key];
        if (!Model) {
            return res.status(404).json({ error: true, message: `Ruta /api/${key} inexistente` });
        }

        if (Array.isArray(data)) {
            if (key !== 'solicitudes-compartir' && key !== 'empresas' && key !== 'administradores') {
                const empresaId = queryEmpresaId || (data.length > 0 ? data[0].empresaId : null);
                const filterDelete = empresaId ? { empresaId } : {};
                await Model.deleteMany(filterDelete);
            }
            if (data.length > 0) {
                const nuevosDatos = data.map(item => {
                    const resolvedEmpresaId = item.empresaId || queryEmpresaId;
                    const resolvedAdminId = item.adminId || queryAdminId;

                    return {
                        ...item,
                        ...(resolvedEmpresaId ? { empresaId: resolvedEmpresaId } : {}),
                        ...(resolvedAdminId ? { adminId: resolvedAdminId } : {})
                    };
                });
                await Model.insertMany(nuevosDatos);
            }
            return res.json({ success: true, count: data.length });
        } else {
            const resolvedEmpresaId = data.empresaId || queryEmpresaId;
            const resolvedAdminId = data.adminId || queryAdminId;

            const itemData = { 
                ...data,
                ...(resolvedEmpresaId ? { empresaId: resolvedEmpresaId } : {}),
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

// ==========================================
// RUTA BACKEND: Enviar Correo de Fianza vía Brevo
// ==========================================
app.post('/enviar-correo-fianza', async (req, res) => {
    try {
        const { correo, huesped, propiedad, monto, link } = req.body;

        if (!correo || !huesped || !link) {
            return res.status(400).json({ error: 'Faltan datos obligatorios para el envío del correo.' });
        }

        const BREVO_API_KEY = process.env.BREVO_API_KEY;
        const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'tucorreo@tudominio.com';
        const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Portal de Fianzas & Garantías';

        if (!BREVO_API_KEY) {
            console.error("Falta configurar la variable de entorno BREVO_API_KEY en el servidor.");
            return res.status(500).json({ error: 'Configuración de correo incompleta en el servidor.' });
        }

        const payloadBrevo = {
            sender: {
                name: BREVO_SENDER_NAME,
                email: BREVO_SENDER_EMAIL
            },
            to: [
                {
                    email: correo,
                    name: huesped
                }
            ],
            subject: `🛡️ Depósito de Garantía Requerido - ${propiedad}`,
            htmlContent: `
