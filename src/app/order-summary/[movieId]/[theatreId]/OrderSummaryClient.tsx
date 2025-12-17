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
    <div className="min-h-screen bg-[#f5f5f5]">
      <div className="container mx-auto max-w-lg px-4 py-8">
        {isConfirmed && (
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-14 w-14 text-green-600" />
            </div>
            <h1 className="text-2xl font-bold text-green-600">Booking Confirmed!</h1>
            <p className="mt-2 text-gray-500">
              Your tickets have been booked successfully
            </p>
          </div>
        )}

        {isExpired && (
          <Alert variant="destructive" className="mb-6 border-red-200 bg-red-50">
            <AlertTitle className="text-red-700">Order Expired</AlertTitle>
            <AlertDescription className="text-red-600">
              Your payment window has expired. Please try booking again.
            </AlertDescription>
          </Alert>
        )}

        {isPending && timeLeft !== null && (
          <div className={`mb-6 p-4 rounded-lg ${timeLeft < 60 ? "bg-red-50 border border-red-200" : "bg-orange-50 border border-orange-200"}`}>
            <p className={`text-sm font-medium ${timeLeft < 60 ? "text-red-700" : "text-orange-700"}`}>
              Complete payment in <span className="text-lg font-bold">{formatTime(timeLeft)}</span>
            </p>
          </div>
        )}

        {error && (
          <Alert variant="destructive" className="mb-6 border-red-200 bg-red-50">
            <AlertTitle className="text-red-700">Error</AlertTitle>
            <AlertDescription className="text-red-600">{error}</AlertDescription>
          </Alert>
        )}

        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-[#1a1a2e] text-white">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Order Summary</CardTitle>
              <Badge
                variant={isConfirmed ? "success" : isExpired ? "destructive" : "secondary"}
                className={
                  isConfirmed
                    ? "bg-green-500 text-white"
                    : isExpired
                      ? "bg-red-500 text-white"
                      : "bg-orange-500 text-white"
                }
              >
                {order.status.replace("_", " ")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {/* Movie Details */}
            <div className="pb-4 border-b">
              <h3 className="font-bold text-[#1a1a2e] text-lg">{order.movie.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{order.theatre.name}</p>
            </div>

            {/* Show Time */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-500">Show Time</span>
              <span className="font-medium text-[#1a1a2e]">{formatShowTime(order.show.startTime)}</span>
            </div>

            {/* Seats */}
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-500">Seats</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {order.seats.map(seat => (
                  <span key={seat} className="px-2 py-0.5 bg-gray-100 rounded text-sm font-medium text-[#1a1a2e]">
                    {seat}
                  </span>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div className="flex items-center justify-between pt-4 border-t">
              <span className="text-gray-600 font-medium">Total Amount</span>
              <span className="text-2xl font-bold text-[#dc3558]">Rs. {order.amount}</span>
            </div>

            {/* Ticket Code (if confirmed) */}
            {isConfirmed && order.ticketCode && (
              <div className="rounded-lg bg-green-50 border border-green-200 p-5 text-center mt-4">
                <p className="text-sm text-green-700 mb-1">Your Ticket Code</p>
                <p className="text-3xl font-bold tracking-widest text-green-800">{order.ticketCode}</p>
                <p className="text-xs text-green-600 mt-2">Show this code at the theatre</p>
              </div>
            )}

            {/* Action Buttons */}
            {isPending && !isExpired && (
              <Button
                className="w-full bg-[#dc3558] hover:bg-[#c42a4a] text-white py-6 text-lg font-semibold mt-4"
                size="lg"
                onClick={handlePayment}
                disabled={paying}
              >
                {paying ? (
                  <span className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Processing Payment...
                  </span>
                ) : (
                  `Pay Rs. ${order.amount}`
                )}
              </Button>
            )}

            {(isConfirmed || isExpired) && (
              <Link href="/" className="block mt-4">
                <Button
                  variant={isConfirmed ? "default" : "outline"}
                  className={`w-full py-6 text-base font-semibold ${
                    isConfirmed
                      ? "bg-[#dc3558] hover:bg-[#c42a4a] text-white"
                      : "border-[#dc3558] text-[#dc3558] hover:bg-[#dc3558] hover:text-white"
                  }`}
                >
                  {isConfirmed ? "Book More Tickets" : "Browse Movies"}
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
