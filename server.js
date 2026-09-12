const express = require('express');
const mongoose = require('mongoose'); 
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const MONGO_URI = process.env.MONGO_URI;

// Opciones de conexión con Timeout estricto para evitar congelamientos
mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000, // Máximo 5 segs buscando servidor
    socketTimeoutMS: 10000,         // Máximo 10 segs por consulta
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
const Tarea = createModuleModel('Tarea', 'tareas');
const ReporteInspeccion = createModuleModel('ReporteInspeccion', 'reportes-inspeccion');
const Lavanderia = createModuleModel('Lavanderia', 'lavanderia');
const Faltante = createModuleModel('Faltante', 'faltantes');
const Programacion = createModuleModel('Programacion', 'programacion');
const Ruta = createModuleModel('Ruta', 'ruta');

// Mapeo de rutas/claves a sus respectivos modelos de Mongoose
const modelsMap = {
    'propiedades': Propiedad,
    'prospectos': Prospecto,
    'empleadas': Empleada,
    'tareas': Tarea,
    'reportes-inspeccion': ReporteInspeccion,
    'lavanderia': Lavanderia,
    'faltantes': Faltante,
    'programacion': Programacion,
    'ruta': Ruta
};

// Endpoint de prueba de conexión directa a la BD
app.get('/api/test-db', async (req, res) => {
    try {
        const estadoMongo = mongoose.connection.readyState;
        // 0: desconectado, 1: conectado, 2: conectando, 3: desconectando
        if (estadoMongo !== 1) {
            return res.status(500).json({ status: 'error', message: 'Mongo no está listo', state: estadoMongo });
        }
        const total = await Propiedad.countDocuments();
        return res.json({ status: 'ok', totalPropiedades: total });
    } catch (error) {
        return res.status(500).json({ status: 'error', detail: error.message });
    }
});

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

        const items = await Model.find({}).exec();

        if (!items || items.length === 0) {
            console.log(`[API INFO] Colección '${key}' vacía, retornando []`);
            return res.json([]);
        }

        console.log(`[API SUCCESS] Colección '${key}' enviada con éxito.`);
        return res.json(items);
    } catch (error) {
        console.error(`[API FATAL] Error procesando '${key}':`, error.message);
        return res.status(500).json({ error: true, message: error.message });
    }
});

// POST Adaptativo para Colecciones (Soporta reemplazo masivo de arrays o inserción individual)
app.post('/api/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = req.body;

        const Model = modelsMap[key];
        if (!Model) {
            return res.status(404).json({ error: true, message: `Ruta /api/${key} inexistente` });
        }

        if (Array.isArray(data)) {
            // Reemplazo completo de la colección si el cliente envía un arreglo completo
            await Model.deleteMany({});
            if (data.length > 0) {
                await Model.insertMany(data);
            }
            return res.json({ success: true, count: data.length });
        } else {
            // Inserción o actualización de un documento individual
            const nuevoItem = new Model(data);
            await nuevoItem.save();
            return res.json({ success: true, data: nuevoItem });
        }
    } catch (error) {
        return res.status(500).json({ error: true, message: error.message });
    }
});

// PATCH Adaptativo por Colección y ID (Para actualizar registros individuales como reportes, tareas, etc.)
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

// DELETE Específico por ID (Ideal para eliminar registros individuales como empleadas, propiedades, etc.)
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

// DELETE Específico por ID (Ya lo tienes configurado en tu servidor Express)
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

// Manejo final de rutas no encontradas bajo /api
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: true, message: `Ruta ${req.originalUrl} inexistente` });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
