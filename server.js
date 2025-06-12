
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import mongoose from 'mongoose';
import axios from 'axios';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Load environment variables
dotenv.config();
const CAR_PORT = process.env.CAR_PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secretkey';

const app = express();

app.use(express.static('public'));
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI).then(() => { 
    console.log('Conectado a MongoDB');
}).catch((error) => {
    console.error('Error al conectar a MongoDB:', error);
});

// Define Course schema and model
const courseSchema = new mongoose.Schema({
    nombre: String,
    descripcion: String,
    precio: Number,
    imagen: String,
    videos: [
        {
            title: String,
            url: String
        }
    ]
});
const Course = mongoose.model('Course', courseSchema);

// Define Payment schema and model
const paymentSchema = new mongoose.Schema({
    courseIds: [Number],
    documento: String,
    correo: String,
    nombre: String,
    plan: String,
    valorTotal: Number,
    paymentResponse: Object,
    createdAt: { type: Date, default: Date.now }
});
const Payment = mongoose.model('Payment', paymentSchema);

// Define User schema and model
const userSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    correo: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    token: { type: String }
});
const User = mongoose.model('usuarios', userSchema);

// Home route
app.get('/', (req, res) => {
    res.sendFile('login.html', { root: 'public' });
});

// API endpoint to get courses from DB
app.get('/api/courses', async (req, res) => {
    try {
        const courses = await Course.find();
        res.json(courses);
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({ error: 'Error fetching courses' });
    }
});

// Register route
app.post('/api/register', async (req, res) => {
    const { nombre, correo, password } = req.body;
    if (!nombre || !correo || !password) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    try {
        const existingUser = await User.findOne({ correo });
        if (existingUser) {
            return res.status(400).json({ error: 'El correo ya está registrado' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const token = jwt.sign({ correo }, JWT_SECRET, { expiresIn: '1h' });
        const newUser = new User({ nombre, correo, password: hashedPassword, token });
        await newUser.save();
        res.json({ token, nombre, correo });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error en el registro' });
    }
});

// API endpoint to save payment info and process payment
app.post('/api/payments', async (req, res) => {
    const { courseIds, documento, correo, nombre, plan, valorTotal } = req.body;

    const apiKey = process.env.PAYU_API_KEY;
    const apiLogin = process.env.PAYU_API_LOGIN;
    const merchantId = process.env.PAYU_MERCHANT_ID;
    const accountId = process.env.PAYU_ACCOUNT_ID;
    const test = process.env.PAYU_TEST; // 1 for test mode

    const referenceCode = `ORDER_${Date.now()}`;
    const currency = 'USD';

    // Generate signature
    const signatureString = `${apiKey}~${merchantId}~${referenceCode}~${valorTotal}~${currency}`;
    const signature = crypto.createHash('md5').update(signatureString).digest('hex');

    const payuUrl = test === '1' 
        ? 'https://sandbox.api.payulatam.com/payments-api/4.0/service.cgi' 
        : 'https://api.payulatam.com/payments-api/4.0/service.cgi';

    const payload = {
        language: 'es',
        command: 'SUBMIT_TRANSACTION',
        merchant: {
            apiKey: apiKey,
            apiLogin: apiLogin
        },
        transaction: {
            order: {
                accountId: accountId,
                referenceCode: referenceCode,
                description: plan,
                language: 'es',
                signature: signature,
                notifyUrl: '', // Optional: URL to receive payment notifications
                additionalValues: {
                    TX_VALUE: {
                        value: valorTotal,
                        currency: currency
                    }
                },
                buyer: {
                    emailAddress: correo,
                    fullName: nombre
                }
            },
            payer: {
                emailAddress: correo,
                fullName: nombre
            },
 
            extraParameters: {
                INSTALLMENTS_NUMBER: 1
            },
            type: 'AUTHORIZATION_AND_CAPTURE',
            paymentCountry: 'US',
            ipAddress: req.ip,
            cookie: req.headers.cookie || '',
            userAgent: req.headers['user-agent'] || ''
        },
        test: test === '1'
    };

    try {
        const response = await axios.post(payuUrl, payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Save payment info to DB
        const payment = new Payment({
            courseIds,
            documento,
            correo,
            nombre,
            plan,
            valorTotal,
            paymentResponse: response.data
        });
        await payment.save();

        res.json(response.data);
    } catch (error) {
        console.error('PayU payment error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Error processing payment' });
    }
});

// Login route
app.post('/api/login', async (req, res) => {
    const { correo, password } = req.body;
    if (!correo || !password) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    try {
        const user = await User.findOne({ correo });
        if (!user) {
            return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
        }
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(400).json({ error: 'Correo o contraseña incorrectos' });
        }
        const token = jwt.sign({ correo }, JWT_SECRET, { expiresIn: '1h' });
        user.token = token;
        await user.save();
        res.json({ token, nombre: user.nombre, correo: user.correo });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error en el login' });
    }
});

app.get('/api/courses/:id', async (req, res) => {
    try {
        const course = await Course.findById(req.params.id);
        if (!course) {
            return res.status(404).json({ error: 'Curso no encontrado' });
        }
        res.json(course);
    } catch (error) {
        console.error('Error fetching course:', error);
        res.status(500).json({ error: 'Error fetching course' });
    }
});

// Proxy endpoint to forward payment data to banco_pasarela
app.post('/api/pagar', async (req, res) => {
    try {
        const response = await axios.post('https://bancopasarela-equipo2.onrender.com/api/pagar', req.body, {
            headers: { 'Content-Type': 'application/json' }
        });
        res.status(response.status).send(response.data);
    } catch (error) {
        console.error('Error forwarding payment data:', error.message);
        res.status(500).send('Error forwarding payment data');
    }
});

app.listen(CAR_PORT, () => {
    console.log(`Servidor corriendo en el puerto ${CAR_PORT}`);
});

app.get('/api/courses/:id', async (req, res) => {
    try {
        const course = await Course.findById(req.params.id);
        if (!course) {
            return res.status(404).json({ error: 'Curso no encontrado' });
        }
        res.json(course);
    } catch (error) {
        console.error('Error fetching course:', error);
        res.status(500).json({ error: 'Error fetching course' });
    }
});

/**
 * Proxy endpoint to forward payment data from equipo1 to equipo2 (banco_pasarela).
 * This endpoint forwards the payment request without attaching any token from equipo2.
 * Equipo1 does not explicitly use the token generated by equipo2 in /api/token.
 */
// Variable para almacenar el token de equipo2
let equipo2Token = null;

// Función para obtener el token desde equipo2
async function fetchEquipo2Token() {
    try {
        const response = await axios.get('https://bancopasarela-equipo2.onrender.com/api/token');
        equipo2Token = response.data.token;
        console.log('Token obtenido de equipo2:', equipo2Token);
    } catch (error) {
        console.error('Error al obtener token de equipo2:', error.message);
    }
}

// Obtener token inicialmente y refrescar cada 50 minutos
fetchEquipo2Token();
setInterval(fetchEquipo2Token, 50 * 60 * 1000);

/**
 * Proxy endpoint para reenviar datos de pago a equipo2 con token en header Authorization
 */
app.post('/api/pagar', async (req, res) => {
    try {
        if (!equipo2Token) {
            await fetchEquipo2Token();
        }
        const response = await axios.post('https://bancopasarela-equipo2.onrender.com/api/pagar', req.body, {
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${equipo2Token}`
            }
        });
        res.status(response.status).send(response.data);
    } catch (error) {
        console.error('Error reenviando datos de pago:', error.message);
        res.status(500).send('Error reenviando datos de pago');
    }
});

app.listen(CAR_PORT, () => {
    console.log(`Servidor corriendo en el puerto ${CAR_PORT}`);
});
