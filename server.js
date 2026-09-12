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

const DataStoreSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

const DataStore = mongoose.model('DataStore', DataStoreSchema);

// Endpoint de prueba de conexión directa a la BD
app.get('/api/test-db', async (req, res) => {
    try {
        const estadoMongo = mongoose.connection.readyState;
        // 0: desconectado, 1: conectado, 2: conectando, 3: desconectando
        if (estadoMongo !== 1) {
            return res.status(500).json({ status: 'error', message: 'Mongo no está listo', state: estadoMongo });
        }
        const total = await DataStore.countDocuments();
        return res.json({ status: 'ok', totalDocumentos: total });
    } catch (error) {
        return res.status(500).json({ status: 'error', detail: error.message });
    }
});

// GET Adaptativo blindado
app.get('/api/:key', async (req, res) => {
    const { key } = req.params;
    console.log(`[API REQUEST] Solicitando clave: ${key}`);

    try {
        // Si Mongo se desconectó, responder de inmediato sin congelar
        if (mongoose.connection.readyState !== 1) {
            console.error(`[API ERROR] Mongo no conectado al pedir: ${key}`);
            return res.status(503).json({ error: true, message: "Base de datos no disponible temporalmente" });
        }

        const item = await DataStore.findOne({ key: key }).exec();

        if (!item || !item.data) {
            console.log(`[API INFO] Clave '${key}' no encontrada, retornando []`);
            return res.json([]);
        }

        console.log(`[API SUCCESS] Clave '${key}' enviada con éxito.`);
        return res.json(item.data);
    } catch (error) {
        console.error(`[API FATAL] Error procesando '${key}':`, error.message);
        return res.status(500).json({ error: true, message: error.message });
    }
});

// POST Adaptativo
app.post('/api/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = req.body;

        const updated = await DataStore.findOneAndUpdate(
            { key: key },
            { key: key, data: data },
            { upsert: true, new: true }
        );

        return res.json({ success: true, key: updated.key });
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
