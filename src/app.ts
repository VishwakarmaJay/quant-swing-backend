import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { verifyUser } from '@middlewares/auth';
import { errorHandler } from '@middlewares/errorHandler';
import { requestLogger } from '@middlewares/logger';
import { notFound } from '@middlewares/notFound';

import authRouter from '@routes/auth';
import brokerRouter from '@routes/broker';
import indexRouter from '@routes/index';
import instrumentRouter from '@routes/instrument';
import orderRouter from '@routes/order';
import positionRouter from '@routes/position';
import tradeSetupRouter from '@routes/tradeSetup';
import userRouter from '@routes/user';

export const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(requestLogger);

/* Routes */
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/instruments', instrumentRouter);

// Protected routes
app.use(verifyUser);
app.use('/user', userRouter);
app.use('/orders', orderRouter);
app.use('/broker', brokerRouter);
app.use('/trade-setups', tradeSetupRouter);
app.use('/positions', positionRouter);

/* 404 + centralized error handling (must be last) */
app.use(notFound);
app.use(errorHandler);
