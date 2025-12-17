"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrderResponse } from "@/lib/types";
import { CheckCircle2 } from "lucide-react";

interface OrderSummaryClientProps {
  orderId: string;
  movieId: string;
  theatreId: string;
}

export function OrderSummaryClient({
  orderId,
  movieId,
  theatreId,
}: OrderSummaryClientProps) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/v1/orders/${orderId}`);
        const data = await res.json();

        if (!res.ok) {
          if (res.status === 401) {
            setError("Please sign in to view your order");
            return;
          }
          setError(data.error?.message ?? "Failed to fetch order");
          return;
        }

        setOrder(data);
      } catch (err) {
        setError("Failed to fetch order details");
      } finally {
        setLoading(false);
      }
    };

    fetchOrder();
  }, [orderId]);

  // Countdown timer
  useEffect(() => {
    if (!order || order.status !== "PAYMENT_PENDING") return;

    const expiresAt = new Date(order.expiresAt);

    const interval = setInterval(() => {
      const now = new Date();
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
      setTimeLeft(diff);

      if (diff === 0) {
        setOrder((prev) => (prev ? { ...prev, status: "EXPIRED" } : null));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [order]);

  const handlePayment = async () => {
    if (!order) return;

    setPaying(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/orders/${orderId}/confirm-payment`, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message ?? "Payment failed");
        return;
      }

      setOrder(data);
    } catch (err) {
      setError("Payment failed. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatShowTime = (startTime: string): string => {
    const date = new Date(startTime);
    return date.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  if (loading) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="mt-4 text-center">
          <Link href="/">
            <Button>Go to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container mx-auto max-w-lg px-4 py-8">
        <Alert>
          <AlertTitle>Order Not Found</AlertTitle>
          <AlertDescription>This order does not exist or has been removed.</AlertDescription>
        </Alert>
        <div className="mt-4 text-center">
          <Link href="/">
            <Button>Go to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const isConfirmed = order.status === "CONFIRMED";
  const isExpired = order.status === "EXPIRED";
  const isPending = order.status === "PAYMENT_PENDING";

  return (
    <div className="container mx-auto max-w-lg px-4 py-8">
      {isConfirmed && (
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-12 w-12 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-green-600">Booking Confirmed!</h1>
          <p className="mt-2 text-muted-foreground">
            Your tickets have been booked successfully
          </p>
        </div>
      )}

      {isExpired && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Order Expired</AlertTitle>
          <AlertDescription>
            Your payment window has expired. Please try booking again.
          </AlertDescription>
        </Alert>
      )}

      {isPending && timeLeft !== null && (
        <Alert className={`mb-6 ${timeLeft < 60 ? "border-destructive" : ""}`}>
          <AlertTitle>Complete Payment</AlertTitle>
          <AlertDescription>
            Time remaining: <strong>{formatTime(timeLeft)}</strong>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Order Summary</CardTitle>
            <Badge
              variant={
                isConfirmed ? "success" : isExpired ? "destructive" : "secondary"
              }
            >
              {order.status.replace("_", " ")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Movie Details */}
          <div>
            <h3 className="font-semibold">{order.movie.title}</h3>
            <p className="text-sm text-muted-foreground">{order.theatre.name}</p>
          </div>

          {/* Show Time */}
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">Show Time</span>
            <span className="font-medium">{formatShowTime(order.show.startTime)}</span>
          </div>

          {/* Seats */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Seats</span>
            <span className="font-medium">{order.seats.join(", ")}</span>
          </div>

          {/* Amount */}
          <div className="flex items-center justify-between border-t pt-4">
            <span className="text-sm text-muted-foreground">Total Amount</span>
            <span className="text-xl font-bold">Rs. {order.amount}</span>
          </div>

          {/* Ticket Code (if confirmed) */}
          {isConfirmed && order.ticketCode && (
            <div className="rounded-lg bg-muted p-4 text-center">
              <p className="text-sm text-muted-foreground">Ticket Code</p>
              <p className="text-2xl font-bold tracking-wider">{order.ticketCode}</p>
            </div>
          )}

          {/* Action Buttons */}
          {isPending && !isExpired && (
            <Button
              className="w-full"
              size="lg"
              onClick={handlePayment}
              disabled={paying}
            >
              {paying ? "Processing Payment..." : `Pay Rs. ${order.amount}`}
            </Button>
          )}

          {(isConfirmed || isExpired) && (
            <Link href="/" className="block">
              <Button variant={isConfirmed ? "default" : "outline"} className="w-full">
                {isConfirmed ? "Book More Tickets" : "Browse Movies"}
              </Button>
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
