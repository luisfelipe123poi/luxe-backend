const express = require('express');
const mongoose = require('mongoose'); 
const cors = require('cors');

const app = express();

// Middlewares
app.use(cors());
// Aumentamos el límite de JSON para soportar fotos en Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Obtener URI de MongoDB desde las variables de entorno de Render
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('🔴 ERROR CRÍTICO: La variable de entorno MONGO_URI no está definida en Render.');
} else {
    // Conexión a MongoDB Atlas
    mongoose.connect(MONGO_URI)
        .then(() => console.log('🟢 Conectado exitosamente a MongoDB Atlas'))
        .catch((err) => console.error('🔴 Error conectando a MongoDB:', err));
}

// ==========================================
// SCHEMAS & MODELOS DE MONGOOSE
// ==========================================

// Colección Genérica de Almacenamiento (Reemplazo directo de localStorage)
const DataStoreSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true });

const DataStore = mongoose.model('DataStore', DataStoreSchema);

// ==========================================
// RUTAS API REST
// ==========================================

// Ruta raíz de prueba
app.get('/', (req, res) => {
    res.send('🚀 Luxe Asset Management API funcionando correctamente en Render');
});

// GET: Obtener datos por clave explícita (Ejemplo: /api/store/lux_properties_v10)
app.get('/api/store/:key', async (req, res) => {
    try {
        const item = await DataStore.findOne({ key: req.params.key });
        if (!item) {
            return res.json([]); // Si no existe, retorna array vacío por defecto
        }
        res.json(item.data);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener datos', details: error.message });
    }
});

// POST: Guardar o Actualizar datos por clave explícita
app.post('/api/store/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = req.body;

        const updated = await DataStore.findOneAndUpdate(
            { key: key },
            { key: key, data: data },
            { upsert: true, new: true }
        );

        res.json({ success: true, key: updated.key });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar datos', details: error.message });
    }
});

// DELETE: Borrar colección por clave explícita
app.delete('/api/store/:key', async (req, res) => {
    try {
        await DataStore.deleteOne({ key: req.params.key });
        res.json({ success: true, message: `Clave ${req.params.key} eliminada.` });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar', details: error.message });
    }
});

// ==========================================
// RUTAS ADAPTATIVAS DIRECTAS (Ej: /api/propiedades, /api/prospectos, etc.)
// ==========================================

// GET dinámico para endpoints genéricos
app.get('/api/:key', async (req, res) => {
    try {
        const item = await DataStore.findOne({ key: req.params.key });
        if (!item) {
            return res.json([]);
        }
        res.json(item.data);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener datos', details: error.message });
    }
});

// POST dinámico para endpoints genéricos
app.post('/api/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const data = req.body;

        const updated = await DataStore.findOneAndUpdate(
            { key: key },
            { key: key, data: data },
            { upsert: true, new: true }
        );

        res.json({ success: true, key: updated.key });
    } catch (error) {
        res.status(500).json({ error: 'Error al guardar datos', details: error.message });
    }
});

// DELETE dinámico para endpoints genéricos
app.delete('/api/:key', async (req, res) => {
    try {
        await DataStore.deleteOne({ key: req.params.key });
        res.json({ success: true, message: `Clave ${req.params.key} eliminada.` });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar', details: error.message });
    }
});

// Arrancar servidor en el puerto asignado por Render (o 5000 por defecto)
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
